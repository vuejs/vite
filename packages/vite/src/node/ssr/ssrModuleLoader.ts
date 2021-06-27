import fs from 'fs'
import path from 'path'
import { ViteDevServer } from '..'
import { cleanUrl, resolveFrom, unwrapId } from '../utils'
import { rebindErrorStacktrace, ssrRewriteStacktrace } from './ssrStacktrace'
import {
  ssrExportAllKey,
  ssrModuleExportsKey,
  ssrImportKey,
  ssrImportMetaKey,
  ssrDynamicImportKey
} from './ssrTransform'
import { transformRequest } from '../server/transformRequest'

interface SSRContext {
  global: NodeJS.Global
}

type SSRModule = Record<string, any>

const pendingModules = new Map<string, Promise<SSRModule>>()
const pendingImports = new Map<string, string[]>()

export async function ssrLoadModule(
  url: string,
  server: ViteDevServer,
  context: SSRContext = { global },
  urlStack: string[] = []
): Promise<SSRModule> {
  url = unwrapId(url)

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
  modulePromise
    .catch(() => {
      pendingImports.delete(url)
    })
    .then(() => {
      pendingModules.delete(url)
    })
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

  // Tolerate circular imports by ensuring the module can be
  // referenced before it's been instantiated.
  mod.ssrModule = ssrModule

  const ssrImportMeta = { url }

  urlStack = urlStack.concat(url)
  const isCircular = (url: string) => urlStack.includes(url)

  // Since dynamic imports can happen in parallel, we need to
  // account for multiple pending deps and duplicate imports.
  const pendingDeps: string[] = []

  const ssrImport = async (dep: string) => {
    if (dep[0] !== '.' && dep[0] !== '/') {
      return nodeRequire(dep, mod.file, server.config.root)
    }
    dep = unwrapId(dep)
    if (!isCircular(dep) && !pendingImports.get(dep)?.some(isCircular)) {
      pendingDeps.push(dep)
      if (pendingDeps.length == 1) {
        pendingImports.set(url, pendingDeps)
      }
      await ssrLoadModule(dep, server, context, urlStack)
      if (pendingDeps.length == 1) {
        pendingImports.delete(url)
      } else {
        pendingDeps.splice(pendingDeps.indexOf(dep), 1)
      }
    }
    return moduleGraph.urlToModuleMap.get(dep)?.ssrModule
  }

  const ssrDynamicImport = (dep: string) => {
    // #3087 dynamic import vars is ignored at rewrite import path,
    // so here need process relative path
    if (dep[0] === '.') {
      dep = path.posix.resolve(path.dirname(url), dep)
    }
    return ssrImport(dep)
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

  try {
    const AsyncFunction = async function () {}.constructor as typeof Function
    const initModule = new AsyncFunction(
      `global`,
      ssrModuleExportsKey,
      ssrImportMetaKey,
      ssrImportKey,
      ssrDynamicImportKey,
      ssrExportAllKey,
      result.code + `\n//# sourceURL=${mod.url}`
    )
    await initModule(
      context.global,
      ssrModule,
      ssrImportMeta,
      ssrImport,
      ssrDynamicImport,
      ssrExportAll
    )
  } catch (e) {
    const stacktrace = ssrRewriteStacktrace(e.stack, moduleGraph)
    rebindErrorStacktrace(e, stacktrace)
    server.config.logger.error(
      `Error when evaluating SSR module ${url}:\n${stacktrace}`,
      {
        timestamp: true,
        clear: server.config.clearScreen
      }
    )
    throw e
  }

  return Object.freeze(ssrModule)
}

function nodeRequire(id: string, importer: string | null, root: string) {
  const mod = require(resolve(id, importer, root))
  const defaultExport = mod.__esModule ? mod.default : mod
  // rollup-style default import interop for cjs
  return new Proxy(mod, {
    get(mod, prop) {
      if (prop === 'default') return defaultExport
      return mod[prop]
    }
  })
}

const resolveCache = new Map<string, string>()

function resolve(id: string, importer: string | null, root: string) {
  const key = id + importer + root
  const cached = resolveCache.get(key)
  if (cached) {
    return cached
  }
  const resolveDir =
    importer && fs.existsSync(cleanUrl(importer))
      ? path.dirname(importer)
      : root
  const resolved = resolveFrom(id, resolveDir, true)
  resolveCache.set(key, resolved)
  return resolved
}
