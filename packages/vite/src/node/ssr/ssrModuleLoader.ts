import path from 'path'
import { Module } from 'module'
import { ViteDevServer } from '..'
import { unwrapId } from '../utils'
import { ssrRewriteStacktrace } from './ssrStacktrace'
import {
  ssrExportAllKey,
  ssrModuleExportsKey,
  ssrImportKey,
  ssrImportMetaKey,
  ssrDynamicImportKey
} from './ssrTransform'
import { transformRequest } from '../server/transformRequest'
import { InternalResolveOptions, tryNodeResolve } from '../plugins/resolve'
import { hookNodeResolve } from '../plugins/ssrRequireHook'

interface SSRContext {
  global: NodeJS.Global
}

type SSRModule = Record<string, any>

const pendingModules = new Map<string, Promise<SSRModule>>()

export async function ssrLoadModule(
  url: string,
  server: ViteDevServer,
  context: SSRContext = { global },
  urlStack: string[] = []
): Promise<SSRModule> {
  url = unwrapId(url)

  if (urlStack.includes(url)) {
    server.config.logger.warn(
      `Circular dependency: ${urlStack.join(' -> ')} -> ${url}`
    )
    return {}
  }

  // when we instantiate multiple dependency modules in parallel, they may
  // point to shared modules. We need to avoid duplicate instantiation attempts
  // by register every module as pending synchronously so that all subsequent
  // request to that module are simply waiting on the same promise.
  const pending = pendingModules.get(url)
  if (pending) {
    return pending
  }

  const modulePromise = instantiateModule(url, server, context, urlStack)
  pendingModules.set(url, modulePromise)
  modulePromise.catch(() => {}).then(() => pendingModules.delete(url))
  return modulePromise
}

async function instantiateModule(
  url: string,
  server: ViteDevServer,
  context: SSRContext = { global },
  urlStack: string[] = []
): Promise<SSRModule> {
  const { moduleGraph } = server
  const mod = await moduleGraph.ensureEntryFromUrl(url)

  if (mod.ssrModule) {
    return mod.ssrModule
  }

  const result =
    mod.ssrTransformResult ||
    (await transformRequest(url, server, { ssr: true }))
  if (!result) {
    // TODO more info? is this even necessary?
    throw new Error(`failed to load module for ssr: ${url}`)
  }

  const ssrModule = {
    [Symbol.toStringTag]: 'Module'
  }
  Object.defineProperty(ssrModule, '__esModule', { value: true })

  const isExternal = (dep: string) => dep[0] !== '.' && dep[0] !== '/'

  await Promise.all(
    result.deps!.map((dep) => {
      if (!isExternal(dep)) {
        return ssrLoadModule(dep, server, context, urlStack.concat(url))
      }
    })
  )

  const {
    isProduction,
    resolve: { dedupe },
    root
  } = server.config

  const resolveOptions: InternalResolveOptions = {
    conditions: ['node'],
    dedupe,
    isBuild: true,
    isProduction,
    // Disable "module" condition.
    isRequire: true,
    mainFields: ['main'],
    root
  }

  const ssrImport = (dep: string) => {
    if (isExternal(dep)) {
      return nodeRequire(dep, mod.file, resolveOptions)
    } else {
      return moduleGraph.urlToModuleMap.get(unwrapId(dep))?.ssrModule
    }
  }

  const ssrDynamicImport = (dep: string) => {
    if (isExternal(dep)) {
      return Promise.resolve(nodeRequire(dep, mod.file, resolveOptions))
    } else {
      // #3087 dynamic import vars is ignored at rewrite import path,
      // so here need process relative path
      if (dep.startsWith('.')) {
        dep = path.posix.resolve(path.dirname(url), dep)
      }
      return ssrLoadModule(dep, server, context, urlStack.concat(url))
    }
  }

  function ssrExportAll(sourceModule: any) {
    for (const key in sourceModule) {
      if (key !== 'default') {
        Object.defineProperty(ssrModule, key, {
          enumerable: true,
          configurable: true,
          get() {
            return sourceModule[key]
          }
        })
      }
    }
  }

  const ssrImportMeta = { url }
  try {
    new Function(
      `global`,
      ssrModuleExportsKey,
      ssrImportMetaKey,
      ssrImportKey,
      ssrDynamicImportKey,
      ssrExportAllKey,
      result.code + `\n//# sourceURL=${mod.url}`
    )(
      context.global,
      ssrModule,
      ssrImportMeta,
      ssrImport,
      ssrDynamicImport,
      ssrExportAll
    )
  } catch (e) {
    e.stack = ssrRewriteStacktrace(e.stack, moduleGraph)
    server.config.logger.error(
      `Error when evaluating SSR module ${url}:\n${e.stack}`,
      {
        timestamp: true,
        clear: server.config.clearScreen
      }
    )
    throw e
  }

  mod.ssrModule = Object.freeze(ssrModule)
  return ssrModule
}

function nodeRequire(
  id: string,
  importer: string | null,
  resolveOptions: InternalResolveOptions
) {
  id = resolveId(id, importer, resolveOptions)

  const loadModule = importer ? Module.createRequire(importer) : require
  const unhookNodeResolve = hookNodeResolve((id, importer) =>
    resolveId(id, importer.id, resolveOptions)
  )
  try {
    var mod = loadModule(id)
  } finally {
    unhookNodeResolve()
  }

  // rollup-style default import interop for cjs
  const defaultExport = mod.__esModule ? mod.default : mod
  return new Proxy(mod, {
    get(mod, prop) {
      if (prop === 'default') return defaultExport
      return mod[prop]
    }
  })
}

function resolveId(
  id: string,
  importer: string | null,
  resolveOptions: InternalResolveOptions
) {
  const resolved = tryNodeResolve(id, importer, resolveOptions, false)
  if (!resolved) {
    throw Error(
      `Cannot find module '${id}'` +
        (importer ? ` imported by '${importer}'` : ``)
    )
  }
  return resolved.id
}
