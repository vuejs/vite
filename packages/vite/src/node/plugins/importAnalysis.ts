import fs from 'fs'
import path from 'path'
import { Plugin } from '../plugin'
import { ResolvedConfig } from '../config'
import chalk from 'chalk'
import MagicString from 'magic-string'
import { init, parse as parseImports, ImportSpecifier } from 'es-module-lexer'
import { isCSSRequest, isDirectCSSRequest } from './css'
import {
  isBuiltin,
  cleanUrl,
  createDebugger,
  generateCodeFrame,
  injectQuery,
  isDataUrl,
  isExternalUrl,
  isJSRequest,
  prettifyUrl,
  timeFrom,
  normalizePath
} from '../utils'
import {
  debugHmr,
  handlePrunedModules,
  lexAcceptedHmrDeps
} from '../server/hmr'
import {
  FS_PREFIX,
  CLIENT_DIR,
  CLIENT_PUBLIC_PATH,
  DEP_VERSION_RE,
  VALID_ID_PREFIX,
  NULL_BYTE_PLACEHOLDER
} from '../constants'
import { ViteDevServer } from '..'
import { checkPublicFile } from './asset'
import { parse as parseJS } from 'acorn'
import type { Node } from 'estree'
import { transformImportGlob } from '../importGlob'
import { makeLegalIdentifier } from '@rollup/pluginutils'
import { shouldExternalizeForSSR } from '../ssr/ssrExternal'

const isDebug = !!process.env.DEBUG
const debugRewrite = createDebugger('vite:rewrite')

const clientDir = normalizePath(CLIENT_DIR)

const skipRE = /\.(map|json)$/
const canSkip = (id: string) => skipRE.test(id) || isDirectCSSRequest(id)

function isExplicitImportRequired(url: string, knownJSSrcExtensions: string[]) {
  return !isJSRequest(url, knownJSSrcExtensions) && !isCSSRequest(url)
}

function markExplicitImport(url: string, knownJSSrcExtensions: string[]) {
  if (isExplicitImportRequired(url, knownJSSrcExtensions)) {
    return injectQuery(url, 'import')
  }
  return url
}

/**
 * Server-only plugin that lexes, resolves, rewrites and analyzes url imports.
 *
 * - Imports are resolved to ensure they exist on disk
 *
 * - Lexes HMR accept calls and updates import relationships in the module graph
 *
 * - Bare module imports are resolved (by @rollup-plugin/node-resolve) to
 * absolute file paths, e.g.
 *
 *     ```js
 *     import 'foo'
 *     ```
 *     is rewritten to
 *     ```js
 *     import '/@fs//project/node_modules/foo/dist/foo.js'
 *     ```
 *
 * - CSS imports are appended with `.js` since both the js module and the actual
 * css (referenced via <link>) may go through the transform pipeline:
 *
 *     ```js
 *     import './style.css'
 *     ```
 *     is rewritten to
 *     ```js
 *     import './style.css.js'
 *     ```
 */
export function importAnalysisPlugin(config: ResolvedConfig): Plugin {
  const { root, base, knownJsSrcExtensions } = config
  const clientPublicPath = path.posix.join(base, CLIENT_PUBLIC_PATH)

  let server: ViteDevServer

  return {
    name: 'vite:import-analysis',

    configureServer(_server) {
      server = _server
    },

    async transform(source, importer, ssr) {
      const prettyImporter = prettifyUrl(importer, root)

      if (canSkip(importer)) {
        isDebug && debugRewrite(chalk.dim(`[skipped] ${prettyImporter}`))
        return null
      }

      const rewriteStart = Date.now()
      await init
      let imports: readonly ImportSpecifier[] = []
      // strip UTF-8 BOM
      if (source.charCodeAt(0) === 0xfeff) {
        source = source.slice(1)
      }
      try {
        imports = parseImports(source)[0]
      } catch (e) {
        const isVue = importer.endsWith('.vue')
        const maybeJSX = !isVue && isJSRequest(importer, knownJsSrcExtensions)

        const msg = isVue
          ? `Install @vitejs/plugin-vue to handle .vue files.`
          : maybeJSX
          ? `If you are using JSX, make sure to name the file with the .jsx or .tsx extension.`
          : `You may need to install appropriate plugins to handle the ${path.extname(
              importer
            )} file format.`

        this.error(
          `Failed to parse source for import analysis because the content ` +
            `contains invalid JS syntax. ` +
            msg,
          e.idx
        )
      }

      if (!imports.length) {
        isDebug &&
          debugRewrite(
            `${timeFrom(rewriteStart)} ${chalk.dim(
              `[no imports] ${prettyImporter}`
            )}`
          )
        return source
      }

      let hasHMR = false
      let isSelfAccepting = false
      let hasEnv = false
      let needQueryInjectHelper = false
      let s: MagicString | undefined
      const str = () => s || (s = new MagicString(source))
      // vite-only server context
      const { moduleGraph } = server
      // since we are already in the transform phase of the importer, it must
      // have been loaded so its entry is guaranteed in the module graph.
      const importerModule = moduleGraph.getModuleById(importer)!
      const importedUrls = new Set<string>()
      const acceptedUrls = new Set<{
        url: string
        start: number
        end: number
      }>()
      const toAbsoluteUrl = (url: string) =>
        path.posix.resolve(path.posix.dirname(importerModule.url), url)

      const normalizeUrl = async (
        url: string,
        pos: number
      ): Promise<[string, string]> => {
        if (base !== '/' && url.startsWith(base)) {
          url = url.replace(base, '/')
        }

        const resolved = await this.resolve(url, importer)

        if (!resolved) {
          this.error(
            `Failed to resolve import "${url}" from "${path.relative(
              process.cwd(),
              importer
            )}". Does the file exist?`,
            pos
          )
        }

        const isRelative = url.startsWith('.')

        // normalize all imports into resolved URLs
        // e.g. `import 'foo'` -> `import '/@fs/.../node_modules/foo/index.js`
        if (resolved.id.startsWith(root + '/')) {
          // in root: infer short absolute path from root
          url = resolved.id.slice(root.length)
        } else if (fs.existsSync(cleanUrl(resolved.id))) {
          // exists but out of root: rewrite to absolute /@fs/ paths
          url = path.posix.join(FS_PREFIX + resolved.id)
        } else {
          url = resolved.id
        }

        if (isExternalUrl(url)) {
          return [url, url]
        }

        // if the resolved id is not a valid browser import specifier,
        // prefix it to make it valid. We will strip this before feeding it
        // back into the transform pipeline
        if (!url.startsWith('.') && !url.startsWith('/')) {
          url =
            VALID_ID_PREFIX + resolved.id.replace('\0', NULL_BYTE_PLACEHOLDER)
        }

        // make the URL browser-valid if not SSR
        if (!ssr) {
          // mark non-js/css imports with `?import`
          url = markExplicitImport(url, knownJsSrcExtensions)

          // for relative js/css imports, inherit importer's version query
          // do not do this for unknown type imports, otherwise the appended
          // query can break 3rd party plugin's extension checks.
          if (isRelative && !/[\?&]import=?\b/.test(url)) {
            const versionMatch = importer.match(DEP_VERSION_RE)
            if (versionMatch) {
              url = injectQuery(url, versionMatch[1])
            }
          }

          // check if the dep has been hmr updated. If yes, we need to attach
          // its last updated timestamp to force the browser to fetch the most
          // up-to-date version of this module.
          try {
            const depModule = await moduleGraph.ensureEntryFromUrl(url)
            if (depModule.lastHMRTimestamp > 0) {
              url = injectQuery(url, `t=${depModule.lastHMRTimestamp}`)
            }
          } catch (e) {
            // it's possible that the dep fails to resolve (non-existent import)
            // attach location to the missing import
            e.pos = pos
            throw e
          }

          // prepend base (dev base is guaranteed to have ending slash)
          url = base + url.replace(/^\//, '')
        }

        return [url, resolved.id]
      }

      for (let index = 0; index < imports.length; index++) {
        const {
          s: start,
          e: end,
          ss: expStart,
          se: expEnd,
          d: dynamicIndex,
          // #2083 User may use escape path,
          // so use imports[index].n to get the unescaped string
          // @ts-ignore
          n: specifier
        } = imports[index]

        const rawUrl = source.slice(start, end)

        // check import.meta usage
        if (rawUrl === 'import.meta') {
          const prop = source.slice(end, end + 4)
          if (prop === '.hot') {
            hasHMR = true
            if (source.slice(end + 4, end + 11) === '.accept') {
              // further analyze accepted modules
              if (
                lexAcceptedHmrDeps(
                  source,
                  source.indexOf('(', end + 11) + 1,
                  acceptedUrls
                )
              ) {
                isSelfAccepting = true
              }
            }
          } else if (prop === '.env') {
            hasEnv = true
          } else if (prop === '.glo' && source[end + 4] === 'b') {
            // transform import.meta.glob()
            // e.g. `import.meta.glob('glob:./dir/*.js')`
            const { imports, importsString, exp, endIndex, base, pattern } =
              await transformImportGlob(
                source,
                start,
                importer,
                index,
                root,
                normalizeUrl
              )
            str().prepend(importsString)
            str().overwrite(expStart, endIndex, exp)
            imports.forEach((url) => importedUrls.add(url.replace(base, '/')))
            if (!(importerModule.file! in server._globImporters)) {
              server._globImporters[importerModule.file!] = {
                module: importerModule,
                importGlobs: []
              }
            }
            server._globImporters[importerModule.file!].importGlobs.push({
              base,
              pattern
            })
          }
          continue
        }

        const isDynamicImport = dynamicIndex >= 0

        // static import or valid string in dynamic import
        // If resolvable, let's resolve it
        if (specifier) {
          // skip external / data uri
          if (isExternalUrl(specifier) || isDataUrl(specifier)) {
            continue
          }
          // skip ssr external
          if (ssr) {
            if (
              server._ssrExternals &&
              shouldExternalizeForSSR(specifier, server._ssrExternals)
            ) {
              continue
            }
            if (isBuiltin(specifier)) {
              continue
            }
          }
          // skip client
          if (specifier === clientPublicPath) {
            continue
          }

          // warn imports to non-asset /public files
          if (
            specifier.startsWith('/') &&
            !config.assetsInclude(cleanUrl(specifier)) &&
            !specifier.endsWith('.json') &&
            checkPublicFile(specifier, config)
          ) {
            throw new Error(
              `Cannot import non-asset file ${specifier} which is inside /public.` +
                `JS/CSS files inside /public are copied as-is on build and ` +
                `can only be referenced via <script src> or <link href> in html.`
            )
          }

          // normalize
          const [normalizedUrl, resolvedId] = await normalizeUrl(
            specifier,
            start
          )
          let url = normalizedUrl

          // record as safe modules
          server?.moduleGraph.safeModulesPath.add(
            cleanUrl(url).slice(4 /* '/@fs'.length */)
          )

          // rewrite
          if (url !== specifier) {
            // for optimized cjs deps, support named imports by rewriting named
            // imports to const assignments.
            if (resolvedId.endsWith(`&es-interop`)) {
              url = url.slice(0, -11)
              if (isDynamicImport) {
                // rewrite `import('package')` to expose the default directly
                str().overwrite(
                  dynamicIndex,
                  end + 1,
                  `import('${url}').then(m => ({ ...m.default, default: m.default }))`
                )
              } else {
                const exp = source.slice(expStart, expEnd)
                const rewritten = transformCjsImport(exp, url, rawUrl, index)
                if (rewritten) {
                  str().overwrite(expStart, expEnd, rewritten)
                } else {
                  // #1439 export * from '...'
                  str().overwrite(start, end, url)
                }
              }
            } else {
              str().overwrite(start, end, isDynamicImport ? `'${url}'` : url)
            }
          }

          // record for HMR import chain analysis
          // make sure to normalize away base
          importedUrls.add(url.replace(base, '/'))
        } else if (!importer.startsWith(clientDir) && !ssr) {
          // check @vite-ignore which suppresses dynamic import warning
          const hasViteIgnore = /\/\*\s*@vite-ignore\s*\*\//.test(rawUrl)

          const url = rawUrl
            .replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '')
            .trim()
          if (!hasViteIgnore && !isSupportedDynamicImport(url)) {
            this.warn(
              `\n` +
                chalk.cyan(importerModule.file) +
                `\n` +
                generateCodeFrame(source, start) +
                `\nThe above dynamic import cannot be analyzed by vite.\n` +
                `See ${chalk.blue(
                  `https://github.com/rollup/plugins/tree/master/packages/dynamic-import-vars#limitations`
                )} ` +
                `for supported dynamic import formats. ` +
                `If this is intended to be left as-is, you can use the ` +
                `/* @vite-ignore */ comment inside the import() call to suppress this warning.\n`
            )
          }
          if (
            !/^('.*'|".*"|`.*`)$/.test(url) ||
            isExplicitImportRequired(url.slice(1, -1), knownJsSrcExtensions)
          ) {
            needQueryInjectHelper = true
            str().overwrite(start, end, `__vite__injectQuery(${url}, 'import')`)
          }
        }
      }

      if (hasEnv) {
        // inject import.meta.env
        let env = `import.meta.env = ${JSON.stringify({
          ...config.env,
          SSR: !!ssr
        })};`
        // account for user env defines
        for (const key in config.define) {
          if (key.startsWith(`import.meta.env.`)) {
            const val = config.define[key]
            env += `${key} = ${
              typeof val === 'string' ? val : JSON.stringify(val)
            };`
          }
        }
        str().prepend(env)
      }

      if (hasHMR && !ssr) {
        debugHmr(
          `${
            isSelfAccepting
              ? `[self-accepts]`
              : acceptedUrls.size
              ? `[accepts-deps]`
              : `[detected api usage]`
          } ${prettyImporter}`
        )
        // inject hot context
        str().prepend(
          `import { createHotContext as __vite__createHotContext } from "${clientPublicPath}";` +
            `import.meta.hot = __vite__createHotContext(${JSON.stringify(
              importerModule.url
            )});`
        )
      }

      if (needQueryInjectHelper) {
        str().prepend(
          `import { injectQuery as __vite__injectQuery } from "${clientPublicPath}";`
        )
      }

      // normalize and rewrite accepted urls
      const normalizedAcceptedUrls = new Set<string>()
      for (const { url, start, end } of acceptedUrls) {
        const [normalized] = await moduleGraph.resolveUrl(
          toAbsoluteUrl(markExplicitImport(url, knownJsSrcExtensions))
        )
        normalizedAcceptedUrls.add(normalized)
        str().overwrite(start, end, JSON.stringify(normalized))
      }

      // update the module graph for HMR analysis.
      // node CSS imports does its own graph update in the css plugin so we
      // only handle js graph updates here.
      if (!isCSSRequest(importer)) {
        const prunedImports = await moduleGraph.updateModuleInfo(
          importerModule,
          importedUrls,
          normalizedAcceptedUrls,
          isSelfAccepting
        )
        if (hasHMR && prunedImports) {
          handlePrunedModules(prunedImports, server)
        }
      }

      if (s) {
        return s.toString()
      } else {
        return source
      }
    }
  }
}

/**
 * https://github.com/rollup/plugins/tree/master/packages/dynamic-import-vars#limitations
 * This is probably less accurate but is much cheaper than a full AST parse.
 */
function isSupportedDynamicImport(url: string) {
  url = url.trim().slice(1, -1)
  // must be relative
  if (!url.startsWith('./') && !url.startsWith('../')) {
    return false
  }
  // must have extension
  if (!path.extname(url)) {
    return false
  }
  // must be more specific if importing from same dir
  if (url.startsWith('./${') && url.indexOf('/') === url.lastIndexOf('/')) {
    return false
  }
  return true
}

type ImportNameSpecifier = { importedName: string; localName: string }

/**
 * Detect import statements to a known optimized CJS dependency and provide
 * ES named imports interop. We do this by rewriting named imports to a variable
 * assignment to the corresponding property on the `module.exports` of the cjs
 * module. Note this doesn't support dynamic re-assignments from within the cjs
 * module.
 *
 * Note that es-module-lexer treats `export * from '...'` as an import as well,
 * so, we may encounter ExportAllDeclaration here, in which case `undefined`
 * will be returned.
 *
 * Credits \@csr632 via #837
 */
function transformCjsImport(
  importExp: string,
  url: string,
  rawUrl: string,
  importIndex: number
): string | undefined {
  const node = (
    parseJS(importExp, {
      ecmaVersion: 2020,
      sourceType: 'module'
    }) as any
  ).body[0] as Node

  if (node.type === 'ImportDeclaration') {
    if (!node.specifiers.length) {
      return `import "${url}"`
    }

    const importNames: ImportNameSpecifier[] = []
    for (const spec of node.specifiers) {
      if (
        spec.type === 'ImportSpecifier' &&
        spec.imported.type === 'Identifier'
      ) {
        const importedName = spec.imported.name
        const localName = spec.local.name
        importNames.push({ importedName, localName })
      } else if (spec.type === 'ImportDefaultSpecifier') {
        importNames.push({
          importedName: 'default',
          localName: spec.local.name
        })
      } else if (spec.type === 'ImportNamespaceSpecifier') {
        importNames.push({ importedName: '*', localName: spec.local.name })
      }
    }

    // If there is multiple import for same id in one file,
    // importIndex will prevent the cjsModuleName to be duplicate
    const cjsModuleName = makeLegalIdentifier(
      `__vite__cjsImport${importIndex}_${rawUrl}`
    )
    const lines: string[] = [`import ${cjsModuleName} from "${url}"`]
    importNames.forEach(({ importedName, localName }) => {
      if (importedName === '*') {
        lines.push(`const ${localName} = ${cjsModuleName}`)
      } else if (importedName === 'default') {
        lines.push(
          `const ${localName} = ${cjsModuleName}.__esModule ? ${cjsModuleName}.default : ${cjsModuleName}`
        )
      } else {
        lines.push(`const ${localName} = ${cjsModuleName}["${importedName}"]`)
      }
    })
    return lines.join('; ')
  }
}
