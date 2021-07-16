import fs from 'fs'
import path from 'path'
import { Plugin } from '../plugin'
import chalk from 'chalk'
import {
  FS_PREFIX,
  SPECIAL_QUERY_RE,
  DEFAULT_EXTENSIONS,
  DEFAULT_MAIN_FIELDS,
  OPTIMIZABLE_ENTRY_RE
} from '../constants'
import {
  isBuiltin,
  bareImportRE,
  createDebugger,
  deepImportRE,
  injectQuery,
  isExternalUrl,
  isObject,
  normalizePath,
  fsPathFromId,
  ensureVolumeInPath,
  resolveFrom,
  isDataUrl,
  cleanUrl,
  slash
} from '../utils'
import { ViteDevServer, SSRTarget } from '..'
import { createFilter } from '@rollup/pluginutils'
import { PartialResolvedId } from 'rollup'
import { resolve as _resolveExports } from 'resolve.exports'

// special id for paths marked with browser: false
// https://github.com/defunctzombie/package-browser-field-spec#ignore-a-module
export const browserExternalId = '__vite-browser-external'

const isDebug = process.env.DEBUG
const debug = createDebugger('vite:resolve-details', {
  onlyWhenFocused: true
})

export interface ResolveOptions {
  mainFields?: string[]
  conditions?: string[]
  extensions?: string[]
  dedupe?: string[]
}

export interface InternalResolveOptions extends ResolveOptions {
  root: string
  isBuild: boolean
  isProduction: boolean
  ssrTarget?: SSRTarget
  /**
   * src code mode also attempts the following:
   * - resolving /xxx as URLs
   * - resolving bare imports from optimized deps
   */
  asSrc?: boolean
  tryIndex?: boolean
  tryPrefix?: string
  preferRelative?: boolean
  isRequire?: boolean
}

export function resolvePlugin(baseOptions: InternalResolveOptions): Plugin {
  const {
    root,
    isProduction,
    asSrc,
    ssrTarget,
    preferRelative = false
  } = baseOptions
  const requireOptions: InternalResolveOptions = {
    ...baseOptions,
    isRequire: true
  }
  let server: ViteDevServer | undefined

  return {
    name: 'vite:resolve',

    configureServer(_server) {
      server = _server
    },

    resolveId(id, importer, resolveOpts, ssr) {
      if (id.startsWith(browserExternalId)) {
        return id
      }

      // fast path for commonjs proxy modules
      if (/\?commonjs/.test(id) || id === 'commonjsHelpers.js') {
        return
      }

      const targetWeb = !ssr || ssrTarget === 'webworker'

      // this is passed by @rollup/plugin-commonjs
      const isRequire =
        resolveOpts &&
        resolveOpts.custom &&
        resolveOpts.custom['node-resolve'] &&
        resolveOpts.custom['node-resolve'].isRequire

      const options = isRequire ? requireOptions : baseOptions

      let res

      // explicit fs paths that starts with /@fs/*
      if (asSrc && id.startsWith(FS_PREFIX)) {
        const fsPath = fsPathFromId(id)
        res = tryFsResolve(fsPath, options)
        isDebug && debug(`[@fs] ${chalk.cyan(id)} -> ${chalk.dim(res)}`)
        // always return here even if res doesn't exist since /@fs/ is explicit
        // if the file doesn't exist it should be a 404
        return res || fsPath
      }

      // URL
      // /foo -> /fs-root/foo
      if (asSrc && id.startsWith('/')) {
        const fsPath = path.resolve(root, id.slice(1))
        if ((res = tryFsResolve(fsPath, options))) {
          isDebug && debug(`[url] ${chalk.cyan(id)} -> ${chalk.dim(res)}`)
          return res
        }
      }

      // relative
      if (id.startsWith('.') || (preferRelative && /^\w/.test(id))) {
        let realImporter: string | undefined
        try {
          // see #3165, ensure relative import resolves to intended file path
          realImporter =
            importer && fs.realpathSync.native(importer.replace(/[?#].*$/g, ''))
        } catch {}

        const basedir = importer
          ? path.dirname(realImporter || importer)
          : process.cwd()
        const fsPath = path.resolve(basedir, id)

        const normalizedFsPath = normalizePath(fsPath)
        const pathFromBasedir = normalizedFsPath.slice(basedir.length)
        if (pathFromBasedir.startsWith('/node_modules/')) {
          // normalize direct imports from node_modules to bare imports, so the
          // hashing logic is shared and we avoid duplicated modules #2503
          const bareImport = pathFromBasedir.slice('/node_modules/'.length)
          if (
            (res = tryNodeResolve(
              bareImport,
              importer,
              options,
              targetWeb,
              server,
              ssr
            )) &&
            res.id.startsWith(normalizedFsPath)
          ) {
            return res
          }
        }

        if (
          targetWeb &&
          (res = tryResolveBrowserMapping(fsPath, importer, options, true))
        ) {
          return res
        }

        if ((res = tryFsResolve(fsPath, options))) {
          isDebug && debug(`[relative] ${chalk.cyan(id)} -> ${chalk.dim(res)}`)
          const pkg = importer != null && idToPkgMap.get(importer)
          if (pkg) {
            idToPkgMap.set(res, pkg)
            return {
              id: res,
              moduleSideEffects: pkg.hasSideEffects(res)
            }
          }
          return res
        }
      }

      // absolute fs paths
      if (path.isAbsolute(id) && (res = tryFsResolve(id, options))) {
        isDebug && debug(`[fs] ${chalk.cyan(id)} -> ${chalk.dim(res)}`)
        return res
      }

      // external
      if (isExternalUrl(id)) {
        return {
          id,
          external: true
        }
      }

      // data uri: pass through (this only happens during build and will be
      // handled by dedicated plugin)
      if (isDataUrl(id)) {
        return null
      }

      // bare package imports, perform node resolve
      if (bareImportRE.test(id)) {
        if (
          asSrc &&
          server &&
          !ssr &&
          (res = tryOptimizedResolve(id, server))
        ) {
          return res
        }

        if (
          targetWeb &&
          (res = tryResolveBrowserMapping(id, importer, options, false))
        ) {
          return res
        }

        if (
          (res = tryNodeResolve(id, importer, options, targetWeb, server, ssr))
        ) {
          return res
        }

        // node built-ins.
        // externalize if building for SSR, otherwise redirect to empty module
        if (isBuiltin(id)) {
          if (ssr) {
            return {
              id,
              external: true
            }
          } else {
            if (!asSrc) {
              debug(
                `externalized node built-in "${id}" to empty module. ` +
                  `(imported by: ${chalk.white.dim(importer)})`
              )
            }
            return isProduction
              ? browserExternalId
              : `${browserExternalId}:${id}`
          }
        }
      }

      isDebug && debug(`[fallthrough] ${chalk.dim(id)}`)
    },

    load(id) {
      if (id.startsWith(browserExternalId)) {
        return isProduction
          ? `export default {}`
          : `export default new Proxy({}, {
  get() {
    throw new Error('Module "${id.slice(
      browserExternalId.length + 1
    )}" has been externalized for browser compatibility and cannot be accessed in client code.')
  }
})`
      }
    }
  }
}

function tryFsResolve(
  fsPath: string,
  options: InternalResolveOptions,
  tryIndex = true,
  targetWeb = true
): string | undefined {
  let file = fsPath
  let postfix = ''

  let postfixIndex = fsPath.indexOf('?')
  if (postfixIndex < 0) {
    postfixIndex = fsPath.indexOf('#')
  }
  if (postfixIndex > 0) {
    file = fsPath.slice(0, postfixIndex)
    postfix = fsPath.slice(postfixIndex)
  }

  let res: string | undefined
  if (
    (res = tryResolveFile(
      file,
      postfix,
      options,
      false,
      targetWeb,
      options.tryPrefix
    ))
  ) {
    return res
  }

  for (const ext of options.extensions || DEFAULT_EXTENSIONS) {
    if (
      (res = tryResolveFile(
        file + ext,
        postfix,
        options,
        false,
        targetWeb,
        options.tryPrefix
      ))
    ) {
      return res
    }
  }

  if (
    (res = tryResolveFile(
      file,
      postfix,
      options,
      tryIndex,
      targetWeb,
      options.tryPrefix
    ))
  ) {
    return res
  }
}

function tryResolveFile(
  file: string,
  postfix: string,
  options: InternalResolveOptions,
  tryIndex: boolean,
  targetWeb: boolean,
  tryPrefix?: string
): string | undefined {
  let isReadable = false
  try {
    // #2051 if we don't have read permission on a directory, existsSync() still
    // works and will result in massively slow subsequent checks (which are
    // unnecessary in the first place)
    fs.accessSync(file, fs.constants.R_OK)
    isReadable = true
  } catch (e) {}
  if (isReadable) {
    if (!fs.statSync(file).isDirectory()) {
      return normalizePath(ensureVolumeInPath(file)) + postfix
    } else if (tryIndex) {
      const pkgPath = file + '/package.json'
      if (fs.existsSync(pkgPath)) {
        // path points to a node package
        const pkg = loadPackageData(pkgPath)
        return resolvePackageEntry(file, pkg, options, targetWeb)
      }
      const index = tryFsResolve(file + '/index', options)
      if (index) return index + postfix
    }
  }
  if (tryPrefix) {
    const prefixed = `${path.dirname(file)}/${tryPrefix}${path.basename(file)}`
    return tryResolveFile(prefixed, postfix, options, tryIndex, targetWeb)
  }
}

export const idToPkgMap = new Map<string, PackageData>()

export function tryNodeResolve(
  id: string,
  importer: string | undefined,
  options: InternalResolveOptions,
  targetWeb: boolean,
  server?: ViteDevServer,
  ssr?: boolean
): PartialResolvedId | undefined {
  const { root, dedupe, isBuild } = options
  const deepMatch = id.match(deepImportRE)
  const pkgId = deepMatch ? deepMatch[1] || deepMatch[2] : id

  let basedir
  if (dedupe && dedupe.includes(pkgId)) {
    basedir = root
  } else if (
    importer &&
    path.isAbsolute(importer) &&
    fs.existsSync(cleanUrl(importer))
  ) {
    basedir = path.dirname(importer)
  } else {
    basedir = root
  }

  const pkg = resolvePackageData(pkgId, basedir)

  if (!pkg) {
    return
  }

  let resolved = deepMatch
    ? resolveDeepImport(id, pkg, options, targetWeb)
    : resolvePackageEntry(id, pkg, options, targetWeb)
  if (!resolved) {
    return
  }
  // link id to pkg for browser field mapping check
  idToPkgMap.set(resolved, pkg)
  if (isBuild) {
    // Resolve package side effects for build so that rollup can better
    // perform tree-shaking
    return {
      id: resolved,
      moduleSideEffects: pkg.hasSideEffects(resolved)
    }
  } else {
    if (
      !resolved.includes('node_modules') || // linked
      !server || // build
      server._isRunningOptimizer || // optimizing
      !server._optimizeDepsMetadata
    ) {
      return { id: resolved }
    }
    // if we reach here, it's a valid dep import that hasn't been optimized.
    const isJsType = OPTIMIZABLE_ENTRY_RE.test(resolved)
    const exclude = server.config.optimizeDeps?.exclude
    if (
      !isJsType ||
      importer?.includes('node_modules') ||
      exclude?.includes(pkgId) ||
      exclude?.includes(id) ||
      SPECIAL_QUERY_RE.test(resolved)
    ) {
      // excluded from optimization
      // Inject a version query to npm deps so that the browser
      // can cache it without re-validation, but only do so for known js types.
      // otherwise we may introduce duplicated modules for externalized files
      // from pre-bundled deps.
      const versionHash = server._optimizeDepsMetadata?.browserHash
      if (versionHash && isJsType) {
        resolved = injectQuery(resolved, `v=${versionHash}`)
      }
    } else {
      // this is a missing import.
      // queue optimize-deps re-run.
      server._registerMissingImport?.(id, resolved, ssr)
    }
    return { id: resolved }
  }
}

export function tryOptimizedResolve(
  id: string,
  server: ViteDevServer
): string | undefined {
  const cacheDir = server.config.cacheDir
  const depData = server._optimizeDepsMetadata
  if (cacheDir && depData) {
    const isOptimized = depData.optimized[id]
    if (isOptimized) {
      return (
        isOptimized.file +
        `?v=${depData.browserHash}${
          isOptimized.needsInterop ? `&es-interop` : ``
        }`
      )
    }
  }
}

export interface PackageData {
  dir: string
  hasSideEffects: (id: string) => boolean
  webResolvedImports: Record<string, string | undefined>
  nodeResolvedImports: Record<string, string | undefined>
  setResolvedCache: (key: string, entry: string, targetWeb: boolean) => void
  getResolvedCache: (key: string, targetWeb: boolean) => string | undefined
  data: {
    [field: string]: any
    version: string
    main: string
    module: string
    browser: string | Record<string, string | false>
    exports: string | Record<string, any> | string[]
    dependencies: Record<string, string>
  }
}

const packageCache = new Map<string, PackageData>()

export function resolvePackageData(
  id: string,
  basedir: string
): PackageData | undefined {
  const cacheKey = id + basedir
  if (packageCache.has(cacheKey)) {
    return packageCache.get(cacheKey)
  }
  try {
    const pkgPath = resolveFrom(`${id}/package.json`, basedir)
    return loadPackageData(pkgPath, cacheKey)
  } catch (e) {
    isDebug && debug(`${chalk.red(`[failed loading package.json]`)} ${id}`)
  }
}

function loadPackageData(pkgPath: string, cacheKey = pkgPath) {
  const data = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
  const pkgDir = path.dirname(pkgPath)
  const { sideEffects } = data
  let hasSideEffects
  if (typeof sideEffects === 'boolean') {
    hasSideEffects = () => sideEffects
  } else if (Array.isArray(sideEffects)) {
    hasSideEffects = createFilter(sideEffects, null, { resolve: pkgDir })
  } else {
    hasSideEffects = () => true
  }

  const pkg: PackageData = {
    dir: pkgDir,
    data,
    hasSideEffects,
    webResolvedImports: {},
    nodeResolvedImports: {},
    setResolvedCache(key: string, entry: string, targetWeb: boolean) {
      if (targetWeb) {
        pkg.webResolvedImports[key] = entry
      } else {
        pkg.nodeResolvedImports[key] = entry
      }
    },
    getResolvedCache(key: string, targetWeb: boolean) {
      if (targetWeb) {
        return pkg.webResolvedImports[key]
      } else {
        return pkg.nodeResolvedImports[key]
      }
    }
  }
  packageCache.set(cacheKey, pkg)
  return pkg
}

export function resolvePackageEntry(
  id: string,
  { dir, data, setResolvedCache, getResolvedCache }: PackageData,
  options: InternalResolveOptions,
  targetWeb: boolean
): string | undefined {
  const cached = getResolvedCache('.', targetWeb)
  if (cached) {
    return cached
  }
  let entryPoint: string | undefined | void

  // resolve exports field with highest priority
  // using https://github.com/lukeed/resolve.exports
  if (data.exports) {
    entryPoint = resolveExports(data, '.', options, targetWeb)
  }

  // if exports resolved to .mjs, still resolve other fields.
  // This is because .mjs files can technically import .cjs files which would
  // make them invalid for pure ESM environments - so if other module/browser
  // fields are present, prioritize those instead.
  if (targetWeb && (!entryPoint || entryPoint.endsWith('.mjs'))) {
    // check browser field
    // https://github.com/defunctzombie/package-browser-field-spec
    const browserEntry =
      typeof data.browser === 'string'
        ? data.browser
        : isObject(data.browser) && data.browser['.']
    if (browserEntry) {
      // check if the package also has a "module" field.
      if (typeof data.module === 'string' && data.module !== browserEntry) {
        // if both are present, we may have a problem: some package points both
        // to ESM, with "module" targeting Node.js, while some packages points
        // "module" to browser ESM and "browser" to UMD.
        // the heuristics here is to actually read the browser entry when
        // possible and check for hints of UMD. If it is UMD, prefer "module"
        // instead; Otherwise, assume it's ESM and use it.
        const resolvedBrowserEntry = tryFsResolve(
          path.join(dir, browserEntry),
          options
        )
        if (resolvedBrowserEntry) {
          const content = fs.readFileSync(resolvedBrowserEntry, 'utf-8')
          if (
            (/typeof exports\s*==/.test(content) &&
              /typeof module\s*==/.test(content)) ||
            /module\.exports\s*=/.test(content)
          ) {
            // likely UMD or CJS(!!! e.g. firebase 7.x), prefer module
            entryPoint = data.module
          }
        }
      } else {
        entryPoint = browserEntry
      }
    }
  }

  if (!entryPoint || entryPoint.endsWith('.mjs')) {
    for (const field of options.mainFields || DEFAULT_MAIN_FIELDS) {
      if (typeof data[field] === 'string') {
        entryPoint = data[field]
        break
      }
    }
  }

  entryPoint = entryPoint || data.main || 'index.js'

  // resolve object browser field in package.json
  const { browser: browserField } = data
  if (targetWeb && isObject(browserField)) {
    entryPoint = mapWithBrowserField(entryPoint, browserField) || entryPoint
  }

  entryPoint = path.join(dir, entryPoint)
  const resolvedEntryPoint = tryFsResolve(entryPoint, options)

  if (resolvedEntryPoint) {
    isDebug &&
      debug(
        `[package entry] ${chalk.cyan(id)} -> ${chalk.dim(resolvedEntryPoint)}`
      )
    setResolvedCache('.', resolvedEntryPoint, targetWeb)
    return resolvedEntryPoint
  } else {
    throw new Error(
      `Failed to resolve entry for package "${id}". ` +
        `The package may have incorrect main/module/exports specified in its package.json.`
    )
  }
}

function resolveExports(
  pkg: PackageData['data'],
  key: string,
  options: InternalResolveOptions,
  targetWeb: boolean
) {
  const conditions = [options.isProduction ? 'production' : 'development']
  if (!options.isRequire) {
    conditions.push('module')
  }
  if (options.conditions) {
    conditions.push(...options.conditions)
  }
  return _resolveExports(pkg, key, {
    browser: targetWeb,
    require: options.isRequire,
    conditions
  })
}

function resolveDeepImport(
  id: string,
  {
    webResolvedImports,
    setResolvedCache,
    getResolvedCache,
    dir,
    data
  }: PackageData,
  options: InternalResolveOptions,
  targetWeb: boolean
): string | undefined {
  id = '.' + id.slice(data.name.length)
  const cache = getResolvedCache(id, targetWeb)
  if (cache) {
    return cache
  }

  let relativeId: string | undefined | void = id
  const { exports: exportsField, browser: browserField } = data

  // map relative based on exports data
  if (exportsField) {
    if (isObject(exportsField) && !Array.isArray(exportsField)) {
      relativeId = resolveExports(data, relativeId, options, targetWeb)
    } else {
      // not exposed
      relativeId = undefined
    }
    if (!relativeId) {
      throw new Error(
        `Package subpath '${relativeId}' is not defined by "exports" in ` +
          `${path.join(dir, 'package.json')}.`
      )
    }
  } else if (targetWeb && isObject(browserField)) {
    const mapped = mapWithBrowserField(relativeId, browserField)
    if (mapped) {
      relativeId = mapped
    } else if (mapped === false) {
      return (webResolvedImports[id] = browserExternalId)
    }
  }

  if (relativeId) {
    const resolved = tryFsResolve(
      path.join(dir, relativeId),
      options,
      !exportsField, // try index only if no exports field
      targetWeb
    )
    if (resolved) {
      isDebug &&
        debug(`[node/deep-import] ${chalk.cyan(id)} -> ${chalk.dim(resolved)}`)
      setResolvedCache(id, resolved, targetWeb)
      return resolved
    }
  }
}

function tryResolveBrowserMapping(
  id: string,
  importer: string | undefined,
  options: InternalResolveOptions,
  isFilePath: boolean
) {
  let res: string | undefined
  const pkg = importer && idToPkgMap.get(importer)
  if (pkg && isObject(pkg.data.browser)) {
    const mapId = isFilePath ? './' + slash(path.relative(pkg.dir, id)) : id
    const browserMappedPath = mapWithBrowserField(mapId, pkg.data.browser)
    if (browserMappedPath) {
      const fsPath = path.join(pkg.dir, browserMappedPath)
      if ((res = tryFsResolve(fsPath, options))) {
        isDebug &&
          debug(`[browser mapped] ${chalk.cyan(id)} -> ${chalk.dim(res)}`)
        idToPkgMap.set(res, pkg)
        return {
          id: res,
          moduleSideEffects: pkg.hasSideEffects(res)
        }
      }
    } else if (browserMappedPath === false) {
      return browserExternalId
    }
  }
}

/**
 * given a relative path in pkg dir,
 * return a relative path in pkg dir,
 * mapped with the "map" object
 *
 * - Returning `undefined` means there is no browser mapping for this id
 * - Returning `false` means this id is explicitly externalized for browser
 */
function mapWithBrowserField(
  relativePathInPkgDir: string,
  map: Record<string, string | false>
): string | false | undefined {
  const normalizedPath = path.posix.normalize(relativePathInPkgDir)

  for (const key in map) {
    const normalizedKey = path.posix.normalize(key)
    if (
      normalizedPath === normalizedKey ||
      equalWithoutSuffix(normalizedPath, normalizedKey, '.js') ||
      equalWithoutSuffix(normalizedPath, normalizedKey, '/index.js')
    ) {
      return map[key]
    }
  }
}

function equalWithoutSuffix(path: string, key: string, suffix: string) {
  return key.endsWith(suffix) && key.slice(0, -suffix.length) === path
}
