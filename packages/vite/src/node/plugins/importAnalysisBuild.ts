import path from 'path'
import { ResolvedConfig } from '../config'
import { Plugin } from '../plugin'
import MagicString from 'magic-string'
import { ImportSpecifier, init, parse as parseImports } from 'es-module-lexer'
import { OutputChunk } from 'rollup'
import { chunkToEmittedCssFileMap } from './css'
import { transformImportGlob } from '../importGlob'

/**
 * A flag for injected helpers. This flag will be set to `false` if the output
 * target is not native es - so that injected helper logic can be conditionally
 * dropped.
 */
export const isModernFlag = `__VITE_IS_MODERN__`
export const preloadMethod = `__vitePreload`
export const preloadMarker = `__VITE_PRELOAD__`

const preloadHelperId = 'vite/preload-helper'
const preloadCode = `let scriptRel;const seen = {};export const ${preloadMethod} = ${preload.toString()}`
const preloadMarkerRE = new RegExp(`"${preloadMarker}"`, 'g')

/**
 * Helper for preloading CSS and direct imports of async chunks in parallel to
 * the async chunk itself.
 */
function preload(baseModule: () => Promise<{}>, deps?: string[]) {
  // @ts-ignore
  if (!__VITE_IS_MODERN__ || !deps || deps.length === 0) {
    return baseModule()
  }

  // @ts-ignore
  if (scriptRel === undefined) {
    // @ts-ignore
    const relList = document.createElement('link').relList
    // @ts-ignore
    scriptRel =
      relList && relList.supports && relList.supports('modulepreload')
        ? 'modulepreload'
        : 'preload'
  }

  return Promise.all(
    deps.map((dep) => {
      // @ts-ignore
      if (dep in seen) return
      // @ts-ignore
      seen[dep] = true
      const isCss = dep.endsWith('.css')
      const cssSelector = isCss ? '[rel="stylesheet"]' : ''
      // @ts-ignore check if the file is already preloaded by SSR markup
      if (document.querySelector(`link[href="${dep}"]${cssSelector}`)) {
        return
      }
      // @ts-ignore
      const link = document.createElement('link')
      // @ts-ignore
      link.rel = isCss ? 'stylesheet' : scriptRel
      if (!isCss) {
        link.as = 'script'
        link.crossOrigin = ''
      }
      link.href = dep
      // @ts-ignore
      document.head.appendChild(link)
      if (isCss) {
        return new Promise((res, rej) => {
          link.addEventListener('load', res)
          link.addEventListener('error', rej)
        })
      }
    })
  ).then(() => baseModule())
}

/**
 * Build only. During serve this is performed as part of ./importAnalysis.
 */
export function buildImportAnalysisPlugin(config: ResolvedConfig): Plugin {
  const ssr = !!config.build.ssr

  return {
    name: 'vite:import-analysis',

    resolveId(id) {
      if (id === preloadHelperId) {
        return id
      }
    },

    load(id) {
      if (id === preloadHelperId) {
        return preloadCode
      }
    },

    async transform(source, importer) {
      if (
        importer.includes('node_modules') &&
        !source.includes('import.meta.glob')
      ) {
        return
      }

      await init

      let imports: readonly ImportSpecifier[] = []
      try {
        imports = parseImports(source)[0]
      } catch (e) {
        this.error(e, e.idx)
      }

      if (!imports.length) {
        return null
      }

      let s: MagicString | undefined
      const str = () => s || (s = new MagicString(source))
      let needPreloadHelper = false

      for (let index = 0; index < imports.length; index++) {
        const {
          s: start,
          e: end,
          ss: expStart,
          d: dynamicIndex
        } = imports[index]

        const isGlob =
          source.slice(start, end) === 'import.meta' &&
          source.slice(end, end + 5) === '.glob'

        // import.meta.glob
        if (isGlob) {
          const { importsString, exp, endIndex, isEager } =
            await transformImportGlob(
              source,
              start,
              importer,
              index,
              config.root,
              undefined,
              ssr
            )
          str().prepend(importsString)
          str().overwrite(expStart, endIndex, exp)
          if (!isEager) {
            needPreloadHelper = true
          }
          continue
        }

        if (dynamicIndex > -1 && !ssr) {
          needPreloadHelper = true
          const dynamicEnd = source.indexOf(`)`, end) + 1
          const original = source.slice(dynamicIndex, dynamicEnd)
          const replacement = `${preloadMethod}(() => ${original},${isModernFlag}?"${preloadMarker}":void 0)`
          str().overwrite(dynamicIndex, dynamicEnd, replacement)
        }
      }

      if (
        needPreloadHelper &&
        !ssr &&
        !source.includes(`const ${preloadMethod} =`)
      ) {
        str().prepend(`import { ${preloadMethod} } from "${preloadHelperId}";`)
      }

      if (s) {
        return {
          code: s.toString(),
          map: config.build.sourcemap ? s.generateMap({ hires: true }) : null
        }
      }
    },

    renderChunk(code, _, { format }) {
      // make sure we only perform the preload logic in modern builds.
      if (code.indexOf(isModernFlag) > -1) {
        const re = new RegExp(isModernFlag, 'g')
        const isModern = String(format === 'es')
        if (config.build.sourcemap) {
          const s = new MagicString(code)
          let match
          while ((match = re.exec(code))) {
            s.overwrite(
              match.index,
              match.index + isModernFlag.length,
              isModern
            )
          }
          return {
            code: s.toString(),
            map: s.generateMap({ hires: true })
          }
        } else {
          return code.replace(re, isModern)
        }
      }
      return null
    },

    generateBundle({ format }, bundle) {
      if (format !== 'es' || ssr) {
        return
      }

      const isPolyfillEnabled = config.build.polyfillDynamicImport
      for (const file in bundle) {
        const chunk = bundle[file]
        // can't use chunk.dynamicImports.length here since some modules e.g.
        // dynamic import to constant json may get inlined.
        if (chunk.type === 'chunk' && chunk.code.indexOf(preloadMarker) > -1) {
          const code = chunk.code
          let imports: ImportSpecifier[]
          try {
            imports = parseImports(code)[0].filter((i) => i.d > -1)
          } catch (e) {
            this.error(e, e.idx)
          }

          if (imports.length) {
            const s = new MagicString(code)
            for (let index = 0; index < imports.length; index++) {
              const { s: start, e: end, d: dynamicIndex } = imports[index]
              // if dynamic import polyfill is used, rewrite the import to
              // use the polyfilled function.
              if (isPolyfillEnabled) {
                s.overwrite(dynamicIndex, dynamicIndex + 6, `__import__`)
              }
              // check the chunk being imported
              const url = code.slice(start, end)
              const deps: Set<string> = new Set()

              if (url[0] === `"` && url[url.length - 1] === `"`) {
                const ownerFilename = chunk.fileName
                // literal import - trace direct imports and add to deps
                const analyzed: Set<string> = new Set<string>()
                const addDeps = (filename: string) => {
                  if (filename === ownerFilename) return
                  if (analyzed.has(filename)) return
                  analyzed.add(filename)
                  const chunk = bundle[filename] as OutputChunk | undefined
                  if (chunk) {
                    // use a relative path https://github.com/vitejs/vite/pull/3061
                    deps.add('./' + chunk.fileName)
                    const cssFiles = chunkToEmittedCssFileMap.get(chunk)
                    if (cssFiles) {
                      cssFiles.forEach((file) => {
                        // use a relative path https://github.com/vitejs/vite/pull/3061
                        deps.add('./' + file)
                      })
                    }
                    chunk.imports.forEach(addDeps)
                  }
                }
                const normalizedFile = path.posix.join(
                  path.posix.dirname(chunk.fileName),
                  url.slice(1, -1)
                )
                addDeps(normalizedFile)
              }

              let markPos = code.indexOf(preloadMarker, end)
              // fix issue #3051
              if (markPos === -1 && imports.length === 1) {
                markPos = code.indexOf(preloadMarker)
              }

              if (markPos > 0) {
                s.overwrite(
                  markPos - 1,
                  markPos + preloadMarker.length + 1,
                  // the dep list includes the main chunk, so only need to
                  // preload when there are actual other deps.
                  deps.size > 1
                    ? `[${[...deps].map((d) => JSON.stringify(d)).join(',')}]`
                    : `[]`
                )
              }
            }
            chunk.code = s.toString()
            // TODO source map
          }

          // there may still be markers due to inlined dynamic imports, remove
          // all the markers regardless
          chunk.code = chunk.code.replace(preloadMarkerRE, 'void 0')
        }
      }
    }
  }
}
