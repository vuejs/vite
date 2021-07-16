import fs from 'fs'
import path from 'path'
import glob from 'fast-glob'
import {
  // createDebugger,
  isExternalUrl,
  asyncReplace,
  cleanUrl,
  generateCodeFrame,
  isDataUrl,
  isObject,
  normalizePath,
  processSrcSet
} from '../utils'
import { Plugin } from '../plugin'
import { ResolvedConfig } from '../config'
import postcssrc from 'postcss-load-config'
import {
  NormalizedOutputOptions,
  OutputChunk,
  RenderedChunk,
  RollupError,
  SourceMap
} from 'rollup'
import { dataToEsm } from '@rollup/pluginutils'
import chalk from 'chalk'
import { CLIENT_PUBLIC_PATH } from '../constants'
import { ResolveFn, ViteDevServer } from '../'
import {
  getAssetFilename,
  assetUrlRE,
  registerAssetToChunk,
  fileToUrl,
  checkPublicFile
} from './asset'
import MagicString from 'magic-string'
import * as Postcss from 'postcss'
import type Sass from 'sass'
// We need to disable check of extraneous import which is buggy for stylus,
// and causes the CI tests fail, see: https://github.com/vitejs/vite/pull/2860
import type Stylus from 'stylus' // eslint-disable-line node/no-extraneous-import
import type Less from 'less'
import { Alias } from 'types/alias'

// const debug = createDebugger('vite:css')

export interface CSSOptions {
  /**
   * https://github.com/css-modules/postcss-modules
   */
  modules?: CSSModulesOptions | false
  preprocessorOptions?: Record<string, any>
  postcss?:
    | string
    | (Postcss.ProcessOptions & {
        plugins?: Postcss.Plugin[]
      })
}

export interface CSSModulesOptions {
  getJSON?: (
    cssFileName: string,
    json: Record<string, string>,
    outputFileName: string
  ) => void
  scopeBehaviour?: 'global' | 'local'
  globalModulePaths?: RegExp[]
  generateScopedName?:
    | string
    | ((name: string, filename: string, css: string) => string)
  hashPrefix?: string
  /**
   * default: null
   */
  localsConvention?:
    | 'camelCase'
    | 'camelCaseOnly'
    | 'dashes'
    | 'dashesOnly'
    | null
}

const cssLangs = `\\.(css|less|sass|scss|styl|stylus|pcss|postcss)($|\\?)`
export const cssLangRE = new RegExp(cssLangs)
const cssModuleRE = new RegExp(`\\.module${cssLangs}`)
const directRequestRE = /(\?|&)direct\b/
const commonjsProxyRE = /\?commonjs-proxy/

const enum PreprocessLang {
  less = 'less',
  sass = 'sass',
  scss = 'scss',
  styl = 'styl',
  stylus = 'stylus'
}
const enum PureCssLang {
  css = 'css'
}
type CssLang = keyof typeof PureCssLang | keyof typeof PreprocessLang

export const isCSSRequest = (request: string): boolean =>
  cssLangRE.test(request) && !directRequestRE.test(request)

export const isDirectCSSRequest = (request: string): boolean =>
  cssLangRE.test(request) && directRequestRE.test(request)

const cssModulesCache = new WeakMap<
  ResolvedConfig,
  Map<string, Record<string, string>>
>()

export const chunkToEmittedCssFileMap = new WeakMap<
  RenderedChunk,
  Set<string>
>()

/**
 * Plugin applied before user plugins
 */
export function cssPlugin(config: ResolvedConfig): Plugin {
  let server: ViteDevServer
  let moduleCache: Map<string, Record<string, string>>

  const resolveUrl = config.createResolver({
    preferRelative: true,
    tryIndex: false,
    extensions: []
  })
  const atImportResolvers = createCSSResolvers(config)

  return {
    name: 'vite:css',

    configureServer(_server) {
      server = _server
    },

    buildStart() {
      // Ensure a new cache for every build (i.e. rebuilding in watch mode)
      moduleCache = new Map<string, Record<string, string>>()
      cssModulesCache.set(config, moduleCache)
    },

    async transform(raw, id) {
      if (!cssLangRE.test(id) || commonjsProxyRE.test(id)) {
        return
      }

      const urlReplacer: CssUrlReplacer = async (url, importer) => {
        if (checkPublicFile(url, config)) {
          return config.base + url.slice(1)
        }
        const resolved = await resolveUrl(url, importer)
        if (resolved) {
          return fileToUrl(resolved, config, this)
        }
        return url
      }

      const {
        code: css,
        modules,
        deps
      } = await compileCSS(
        id,
        raw,
        config,
        urlReplacer,
        atImportResolvers,
        server
      )
      if (modules) {
        moduleCache.set(id, modules)
      }

      // track deps for build watch mode
      if (config.command === 'build' && config.build.watch && deps) {
        for (const file of deps) {
          this.addWatchFile(file)
        }
      }

      // dev
      if (server) {
        // server only logic for handling CSS @import dependency hmr
        const { moduleGraph } = server
        const thisModule = moduleGraph.getModuleById(id)!

        // CSS modules cannot self-accept since it exports values
        const isSelfAccepting = !modules
        if (deps) {
          // record deps in the module graph so edits to @import css can trigger
          // main import to hot update
          const depModules = new Set(
            [...deps].map((file) => moduleGraph.createFileOnlyEntry(file))
          )
          moduleGraph.updateModuleInfo(
            thisModule,
            depModules,
            // The root CSS proxy module is self-accepting and should not
            // have an explicit accept list
            new Set(),
            isSelfAccepting
          )
          for (const file of deps) {
            this.addWatchFile(file)
          }
        } else {
          thisModule.isSelfAccepting = isSelfAccepting
        }
      }

      return {
        code: css,
        // TODO CSS source map
        map: { mappings: '' }
      }
    }
  }
}

/**
 * Plugin applied after user plugins
 */
export function cssPostPlugin(config: ResolvedConfig): Plugin {
  // styles initialization in buildStart causes a styling loss in watch
  const styles: Map<string, string> = new Map<string, string>()
  let pureCssChunks: Set<string>

  // when there are multiple rollup outputs and extracting CSS, only emit once,
  // since output formats have no effect on the generated CSS.
  let outputToExtractedCSSMap: Map<NormalizedOutputOptions, string>
  let hasEmitted = false

  return {
    name: 'vite:css-post',

    buildStart() {
      // Ensure new caches for every build (i.e. rebuilding in watch mode)
      pureCssChunks = new Set<string>()
      outputToExtractedCSSMap = new Map<NormalizedOutputOptions, string>()
      hasEmitted = false
    },

    transform(css, id, ssr) {
      if (!cssLangRE.test(id) || commonjsProxyRE.test(id)) {
        return
      }

      const modules = cssModulesCache.get(config)!.get(id)
      const modulesCode =
        modules && dataToEsm(modules, { namedExports: true, preferConst: true })

      if (config.command === 'serve') {
        if (isDirectCSSRequest(id)) {
          return css
        } else {
          // server only
          if (ssr) {
            return modulesCode || `export default ${JSON.stringify(css)}`
          }
          return [
            `import { updateStyle, removeStyle } from ${JSON.stringify(
              path.posix.join(config.base, CLIENT_PUBLIC_PATH)
            )}`,
            `const id = ${JSON.stringify(id)}`,
            `const css = ${JSON.stringify(css)}`,
            `updateStyle(id, css)`,
            // css modules exports change on edit so it can't self accept
            `${modulesCode || `import.meta.hot.accept()\nexport default css`}`,
            `import.meta.hot.prune(() => removeStyle(id))`
          ].join('\n')
        }
      }

      // build CSS handling ----------------------------------------------------

      // record css
      styles.set(id, css)

      return {
        code: modulesCode || `export default ${JSON.stringify(css)}`,
        map: { mappings: '' },
        // avoid the css module from being tree-shaken so that we can retrieve
        // it in renderChunk()
        moduleSideEffects: 'no-treeshake'
      }
    },

    async renderChunk(code, chunk, opts) {
      let chunkCSS = ''
      let isPureCssChunk = true
      const ids = Object.keys(chunk.modules)
      for (const id of ids) {
        if (
          !isCSSRequest(id) ||
          cssModuleRE.test(id) ||
          commonjsProxyRE.test(id)
        ) {
          isPureCssChunk = false
        }
        if (styles.has(id)) {
          chunkCSS += styles.get(id)
        }
      }

      if (!chunkCSS) {
        return null
      }

      // resolve asset URL placeholders to their built file URLs and perform
      // minification if necessary
      const processChunkCSS = async (
        css: string,
        {
          inlined,
          minify
        }: {
          inlined: boolean
          minify: boolean
        }
      ) => {
        // replace asset url references with resolved url.
        const isRelativeBase = config.base === '' || config.base.startsWith('.')
        css = css.replace(assetUrlRE, (_, fileHash, postfix = '') => {
          const filename = getAssetFilename(fileHash, config) + postfix
          registerAssetToChunk(chunk, filename)
          if (!isRelativeBase || inlined) {
            // absolute base or relative base but inlined (injected as style tag into
            // index.html) use the base as-is
            return config.base + filename
          } else {
            // relative base + extracted CSS - asset file will be in the same dir
            return `./${path.posix.basename(filename)}`
          }
        })
        // only external @imports should exist at this point - and they need to
        // be hoisted to the top of the CSS chunk per spec (#1845)
        if (css.includes('@import')) {
          css = await hoistAtImports(css)
        }
        if (minify && config.build.minify) {
          css = await minifyCSS(css, config)
        }
        return css
      }

      if (config.build.cssCodeSplit) {
        if (isPureCssChunk) {
          // this is a shared CSS-only chunk that is empty.
          pureCssChunks.add(chunk.fileName)
        }
        if (opts.format === 'es' || opts.format === 'cjs') {
          chunkCSS = await processChunkCSS(chunkCSS, {
            inlined: false,
            minify: true
          })
          // emit corresponding css file
          const fileHandle = this.emitFile({
            name: chunk.name + '.css',
            type: 'asset',
            source: chunkCSS
          })
          chunkToEmittedCssFileMap.set(
            chunk,
            new Set([this.getFileName(fileHandle)])
          )
        } else if (!config.build.ssr) {
          // legacy build, inline css
          chunkCSS = await processChunkCSS(chunkCSS, {
            inlined: true,
            minify: true
          })
          const style = `__vite_style__`
          const injectCode =
            `var ${style} = document.createElement('style');` +
            `${style}.innerHTML = ${JSON.stringify(chunkCSS)};` +
            `document.head.appendChild(${style});`
          if (config.build.sourcemap) {
            const s = new MagicString(code)
            s.prepend(injectCode)
            return {
              code: s.toString(),
              map: s.generateMap({ hires: true })
            }
          } else {
            return { code: injectCode + code }
          }
        }
      } else {
        // non-split extracted CSS will be minified together
        chunkCSS = await processChunkCSS(chunkCSS, {
          inlined: false,
          minify: false
        })
        outputToExtractedCSSMap.set(
          opts,
          (outputToExtractedCSSMap.get(opts) || '') + chunkCSS
        )
      }
      return null
    },

    async generateBundle(opts, bundle) {
      // @ts-ignore injected by @vitejs/plugin-legacy
      if (opts.__vite_legacy) {
        return
      }
      // remove empty css chunks and their imports
      if (pureCssChunks.size) {
        const emptyChunkFiles = [...pureCssChunks]
          .map((file) => path.basename(file))
          .join('|')
          .replace(/\./g, '\\.')
        const emptyChunkRE = new RegExp(
          opts.format === 'es'
            ? `\\bimport\\s*"[^"]*(?:${emptyChunkFiles})";\n?`
            : `\\brequire\\(\\s*"[^"]*(?:${emptyChunkFiles})"\\);\n?`,
          'g'
        )
        for (const file in bundle) {
          const chunk = bundle[file]
          if (chunk.type === 'chunk') {
            // remove pure css chunk from other chunk's imports,
            // and also register the emitted CSS files under the importer
            // chunks instead.
            chunk.imports = chunk.imports.filter((file) => {
              if (pureCssChunks.has(file)) {
                const css = chunkToEmittedCssFileMap.get(
                  bundle[file] as OutputChunk
                )
                if (css) {
                  let existing = chunkToEmittedCssFileMap.get(chunk)
                  if (!existing) {
                    existing = new Set()
                  }
                  css.forEach((file) => existing!.add(file))
                  chunkToEmittedCssFileMap.set(chunk, existing)
                }
                return false
              }
              return true
            })
            chunk.code = chunk.code.replace(
              emptyChunkRE,
              // remove css import while preserving source map location
              (m) => `/* empty css ${''.padEnd(m.length - 15)}*/`
            )
          }
        }
        pureCssChunks.forEach((fileName) => {
          delete bundle[fileName]
        })
      }

      let extractedCss = outputToExtractedCSSMap.get(opts)
      if (extractedCss && !hasEmitted) {
        hasEmitted = true
        // minify css
        if (config.build.minify) {
          extractedCss = await minifyCSS(extractedCss, config)
        }
        this.emitFile({
          name: 'style.css',
          type: 'asset',
          source: extractedCss
        })
      }
    }
  }
}

interface CSSAtImportResolvers {
  css: ResolveFn
  sass: ResolveFn
  less: ResolveFn
}

function createCSSResolvers(config: ResolvedConfig): CSSAtImportResolvers {
  let cssResolve: ResolveFn | undefined
  let sassResolve: ResolveFn | undefined
  let lessResolve: ResolveFn | undefined
  return {
    get css() {
      return (
        cssResolve ||
        (cssResolve = config.createResolver({
          extensions: ['.css'],
          mainFields: ['style'],
          tryIndex: false,
          preferRelative: true
        }))
      )
    },

    get sass() {
      return (
        sassResolve ||
        (sassResolve = config.createResolver({
          extensions: ['.scss', '.sass', '.css'],
          mainFields: ['sass', 'style'],
          tryIndex: true,
          tryPrefix: '_',
          preferRelative: true
        }))
      )
    },

    get less() {
      return (
        lessResolve ||
        (lessResolve = config.createResolver({
          extensions: ['.less', '.css'],
          mainFields: ['less', 'style'],
          tryIndex: false,
          preferRelative: true
        }))
      )
    }
  }
}

async function compileCSS(
  id: string,
  code: string,
  config: ResolvedConfig,
  urlReplacer: CssUrlReplacer,
  atImportResolvers: CSSAtImportResolvers,
  server?: ViteDevServer
): Promise<{
  code: string
  map?: SourceMap
  ast?: Postcss.Result
  modules?: Record<string, string>
  deps?: Set<string>
}> {
  const { modules: modulesOptions, preprocessorOptions } = config.css || {}
  const isModule = modulesOptions !== false && cssModuleRE.test(id)
  // although at serve time it can work without processing, we do need to
  // crawl them in order to register watch dependencies.
  const needInlineImport = code.includes('@import')
  const hasUrl = cssUrlRE.test(code) || cssImageSetRE.test(code)
  const postcssConfig = await resolvePostcssConfig(config)
  const lang = id.match(cssLangRE)?.[1] as CssLang | undefined

  // 1. plain css that needs no processing
  if (
    lang === 'css' &&
    !postcssConfig &&
    !isModule &&
    !needInlineImport &&
    !hasUrl
  ) {
    return { code }
  }

  let map: SourceMap | undefined
  let modules: Record<string, string> | undefined
  const deps = new Set<string>()

  // 2. pre-processors: sass etc.
  if (isPreProcessor(lang)) {
    const preProcessor = preProcessors[lang]
    let opts = (preprocessorOptions && preprocessorOptions[lang]) || {}
    // support @import from node dependencies by default
    switch (lang) {
      case PreprocessLang.scss:
      case PreprocessLang.sass:
        opts = {
          includePaths: ['node_modules'],
          alias: config.resolve.alias,
          ...opts
        }
        break
      case PreprocessLang.less:
      case PreprocessLang.styl:
      case PreprocessLang.stylus:
        opts = {
          paths: ['node_modules'],
          alias: config.resolve.alias,
          ...opts
        }
    }
    // important: set this for relative import resolving
    opts.filename = cleanUrl(id)
    const preprocessResult = await preProcessor(
      code,
      config.root,
      opts,
      atImportResolvers
    )
    if (preprocessResult.errors.length) {
      throw preprocessResult.errors[0]
    }

    code = preprocessResult.code
    map = preprocessResult.map as SourceMap
    if (preprocessResult.deps) {
      preprocessResult.deps.forEach((dep) => {
        // sometimes sass registers the file itself as a dep
        if (normalizePath(dep) !== normalizePath(opts.filename)) {
          deps.add(dep)
        }
      })
    }
  }

  // 3. postcss
  const postcssOptions = (postcssConfig && postcssConfig.options) || {}
  const postcssPlugins =
    postcssConfig && postcssConfig.plugins ? postcssConfig.plugins.slice() : []

  if (needInlineImport) {
    postcssPlugins.unshift(
      (await import('postcss-import')).default({
        async resolve(id, basedir) {
          const resolved = await atImportResolvers.css(
            id,
            path.join(basedir, '*')
          )
          if (resolved) {
            return path.resolve(resolved)
          }
          return id
        }
      })
    )
  }
  postcssPlugins.push(
    UrlRewritePostcssPlugin({
      replacer: urlReplacer
    }) as Postcss.Plugin
  )

  if (isModule) {
    postcssPlugins.unshift(
      (await import('postcss-modules')).default({
        ...modulesOptions,
        getJSON(
          cssFileName: string,
          _modules: Record<string, string>,
          outputFileName: string
        ) {
          modules = _modules
          if (modulesOptions && typeof modulesOptions.getJSON === 'function') {
            modulesOptions.getJSON(cssFileName, _modules, outputFileName)
          }
        }
      })
    )
  }

  if (!postcssPlugins.length) {
    return {
      code,
      map
    }
  }

  // postcss is an unbundled dep and should be lazy imported
  const postcssResult = await (await import('postcss'))
    .default(postcssPlugins)
    .process(code, {
      ...postcssOptions,
      to: id,
      from: id,
      map: {
        inline: false,
        annotation: false,
        prev: map
      }
    })

  // record CSS dependencies from @imports
  for (const message of postcssResult.messages) {
    if (message.type === 'dependency') {
      deps.add(message.file as string)
    } else if (message.type === 'dir-dependency') {
      // https://github.com/postcss/postcss/blob/main/docs/guidelines/plugin.md#3-dependencies
      const { dir, glob: globPattern = '**' } = message
      const pattern =
        normalizePath(path.resolve(path.dirname(id), dir)) + `/` + globPattern
      const files = glob.sync(pattern, {
        ignore: ['**/node_modules/**']
      })
      for (let i = 0; i < files.length; i++) {
        deps.add(files[i])
      }
      if (server) {
        // register glob importers so we can trigger updates on file add/remove
        if (!(id in server._globImporters)) {
          server._globImporters[id] = {
            module: server.moduleGraph.getModuleById(id)!,
            importGlobs: []
          }
        }
        server._globImporters[id].importGlobs.push({
          base: config.root,
          pattern
        })
      }
    } else if (message.type === 'warning') {
      let msg = `[vite:css] ${message.text}`
      if (message.line && message.column) {
        msg += `\n${generateCodeFrame(code, {
          line: message.line,
          column: message.column
        })}`
      }
      config.logger.warn(chalk.yellow(msg))
    }
  }

  return {
    ast: postcssResult,
    code: postcssResult.css,
    map: postcssResult.map as any,
    modules,
    deps
  }
}

interface PostCSSConfigResult {
  options: Postcss.ProcessOptions
  plugins: Postcss.Plugin[]
}

let cachedPostcssConfig: PostCSSConfigResult | null | undefined

async function resolvePostcssConfig(
  config: ResolvedConfig
): Promise<PostCSSConfigResult | null> {
  if (cachedPostcssConfig !== undefined) {
    return cachedPostcssConfig
  }

  // inline postcss config via vite config
  const inlineOptions = config.css?.postcss
  if (isObject(inlineOptions)) {
    const result = {
      options: { ...inlineOptions },
      plugins: inlineOptions.plugins || []
    }
    delete result.options.plugins
    return (cachedPostcssConfig = result)
  }

  try {
    const searchPath =
      typeof inlineOptions === 'string' ? inlineOptions : config.root
    // @ts-ignore
    return (cachedPostcssConfig = await postcssrc({}, searchPath))
  } catch (e) {
    if (!/No PostCSS Config found/.test(e.message)) {
      throw e
    }
    return (cachedPostcssConfig = null)
  }
}

type CssUrlReplacer = (
  url: string,
  importer?: string
) => string | Promise<string>
// https://drafts.csswg.org/css-syntax-3/#identifier-code-point
export const cssUrlRE =
  /(?<=^|[^\w\-\u0080-\uffff])url\(\s*('[^']+'|"[^"]+"|[^'")]+)\s*\)/
const cssImageSetRE = /image-set\(([^)]+)\)/

const UrlRewritePostcssPlugin: Postcss.PluginCreator<{
  replacer: CssUrlReplacer
}> = (opts) => {
  if (!opts) {
    throw new Error('base or replace is required')
  }

  return {
    postcssPlugin: 'vite-url-rewrite',
    Once(root) {
      const promises: Promise<void>[] = []
      root.walkDecls((declaration) => {
        const isCssUrl = cssUrlRE.test(declaration.value)
        const isCssImageSet = cssImageSetRE.test(declaration.value)
        if (isCssUrl || isCssImageSet) {
          const replacerForDeclaration = (rawUrl: string) => {
            const importer = declaration.source?.input.file
            return opts.replacer(rawUrl, importer)
          }
          const rewriterToUse = isCssUrl ? rewriteCssUrls : rewriteCssImageSet
          promises.push(
            rewriterToUse(declaration.value, replacerForDeclaration).then(
              (url) => {
                declaration.value = url
              }
            )
          )
        }
      })
      if (promises.length) {
        return Promise.all(promises) as any
      }
    }
  }
}
UrlRewritePostcssPlugin.postcss = true

function rewriteCssUrls(
  css: string,
  replacer: CssUrlReplacer
): Promise<string> {
  return asyncReplace(css, cssUrlRE, async (match) => {
    const [matched, rawUrl] = match
    return await doUrlReplace(rawUrl, matched, replacer)
  })
}

function rewriteCssImageSet(
  css: string,
  replacer: CssUrlReplacer
): Promise<string> {
  return asyncReplace(css, cssImageSetRE, async (match) => {
    const [matched, rawUrl] = match
    const url = await processSrcSet(rawUrl, ({ url }) =>
      doUrlReplace(url, matched, replacer)
    )
    return `image-set(${url})`
  })
}
async function doUrlReplace(
  rawUrl: string,
  matched: string,
  replacer: CssUrlReplacer
) {
  let wrap = ''
  const first = rawUrl[0]
  if (first === `"` || first === `'`) {
    wrap = first
    rawUrl = rawUrl.slice(1, -1)
  }
  if (isExternalUrl(rawUrl) || isDataUrl(rawUrl) || rawUrl.startsWith('#')) {
    return matched
  }

  return `url(${wrap}${await replacer(rawUrl)}${wrap})`
}

let CleanCSS: any

async function minifyCSS(css: string, config: ResolvedConfig) {
  CleanCSS = CleanCSS || (await import('clean-css')).default
  const res = new CleanCSS({
    rebase: false,
    ...config.build.cleanCssOptions
  }).minify(css)

  if (res.errors && res.errors.length) {
    config.logger.error(chalk.red(`error when minifying css:\n${res.errors}`))
    throw res.errors[0]
  }

  // do not warn on remote @imports
  const warnings =
    res.warnings &&
    res.warnings.filter((m: string) => !m.includes('remote @import'))
  if (warnings && warnings.length) {
    config.logger.warn(
      chalk.yellow(`warnings when minifying css:\n${warnings.join('\n')}`)
    )
  }

  return res.styles
}

// #1845
// CSS @import can only appear at top of the file. We need to hoist all @import
// to top when multiple files are concatenated.
async function hoistAtImports(css: string) {
  const postcss = await import('postcss')
  return (await postcss.default([AtImportHoistPlugin]).process(css)).css
}

const AtImportHoistPlugin: Postcss.PluginCreator<any> = () => {
  return {
    postcssPlugin: 'vite-hoist-at-imports',
    Once(root) {
      const imports: Postcss.AtRule[] = []
      root.walkAtRules((rule) => {
        if (rule.name === 'import') {
          // record in reverse so that can simply prepend to preserve order
          imports.unshift(rule)
        }
      })
      imports.forEach((i) => root.prepend(i))
    }
  }
}
AtImportHoistPlugin.postcss = true

// Preprocessor support. This logic is largely replicated from @vue/compiler-sfc

type PreprocessorAdditionalData =
  | string
  | ((source: string, filename: string) => string | Promise<string>)

type StylePreprocessorOptions = {
  [key: string]: any
  additionalData?: PreprocessorAdditionalData
  filename: string
  alias: Alias[]
}

type SassStylePreprocessorOptions = StylePreprocessorOptions & Sass.Options

type StylePreprocessor = (
  source: string,
  root: string,
  options: StylePreprocessorOptions,
  resolvers: CSSAtImportResolvers
) => StylePreprocessorResults | Promise<StylePreprocessorResults>

type SassStylePreprocessor = (
  source: string,
  root: string,
  options: SassStylePreprocessorOptions,
  resolvers: CSSAtImportResolvers
) => StylePreprocessorResults | Promise<StylePreprocessorResults>

export interface StylePreprocessorResults {
  code: string
  map?: object
  errors: RollupError[]
  deps: string[]
}

const loadedPreprocessors: Partial<Record<PreprocessLang, any>> = {}

function loadPreprocessor(lang: PreprocessLang.scss, root: string): typeof Sass
function loadPreprocessor(lang: PreprocessLang.sass, root: string): typeof Sass
function loadPreprocessor(lang: PreprocessLang.less, root: string): typeof Less
function loadPreprocessor(
  lang: PreprocessLang.stylus,
  root: string
): typeof Stylus
function loadPreprocessor(lang: PreprocessLang, root: string): any {
  if (lang in loadedPreprocessors) {
    return loadedPreprocessors[lang]
  }
  try {
    // Search for the preprocessor in the root directory first, and fall back
    // to the default require paths.
    const fallbackPaths = require.resolve.paths(lang) || []
    const resolved = require.resolve(lang, { paths: [root, ...fallbackPaths] })
    return (loadedPreprocessors[lang] = require(resolved))
  } catch (e) {
    throw new Error(
      `Preprocessor dependency "${lang}" not found. Did you install it?`
    )
  }
}

// .scss/.sass processor
const scss: SassStylePreprocessor = async (
  source,
  root,
  options,
  resolvers
) => {
  const render = loadPreprocessor(PreprocessLang.sass, root).render
  const internalImporter: Sass.Importer = (url, importer, done) => {
    resolvers.sass(url, importer).then((resolved) => {
      if (resolved) {
        rebaseUrls(resolved, options.filename, options.alias).then(done)
      } else {
        done(null)
      }
    })
  }
  const importer = [internalImporter]
  if (options.importer) {
    Array.isArray(options.importer)
      ? importer.push(...options.importer)
      : importer.push(options.importer)
  }

  const finalOptions: Sass.Options = {
    ...options,
    data: await getSource(source, options.filename, options.additionalData),
    file: options.filename,
    outFile: options.filename,
    importer
  }

  try {
    const result = await new Promise<Sass.Result>((resolve, reject) => {
      render(finalOptions, (err, res) => {
        if (err) {
          reject(err)
        } else {
          resolve(res)
        }
      })
    })
    const deps = result.stats.includedFiles

    return {
      code: result.css.toString(),
      errors: [],
      deps
    }
  } catch (e) {
    // normalize SASS error
    e.id = e.file
    e.frame = e.formatted
    return { code: '', errors: [e], deps: [] }
  }
}

const sass: SassStylePreprocessor = (source, root, options, aliasResolver) =>
  scss(
    source,
    root,
    {
      ...options,
      indentedSyntax: true
    },
    aliasResolver
  )

/**
 * relative url() inside \@imported sass and less files must be rebased to use
 * root file as base.
 */
async function rebaseUrls(
  file: string,
  rootFile: string,
  alias: Alias[]
): Promise<Sass.ImporterReturnType> {
  file = path.resolve(file) // ensure os-specific flashes
  // in the same dir, no need to rebase
  const fileDir = path.dirname(file)
  const rootDir = path.dirname(rootFile)
  if (fileDir === rootDir) {
    return { file }
  }
  // no url()
  const content = fs.readFileSync(file, 'utf-8')
  if (!cssUrlRE.test(content)) {
    return { file }
  }
  const rebased = await rewriteCssUrls(content, (url) => {
    if (url.startsWith('/')) return url
    // match alias, no need to rewrite
    for (const { find } of alias) {
      const matches =
        typeof find === 'string' ? url.startsWith(find) : find.test(url)
      if (matches) {
        return url
      }
    }
    const absolute = path.resolve(fileDir, url)
    const relative = path.relative(rootDir, absolute)
    return normalizePath(relative)
  })
  return {
    file,
    contents: rebased
  }
}

// .less
const less: StylePreprocessor = async (source, root, options, resolvers) => {
  const nodeLess = loadPreprocessor(PreprocessLang.less, root)
  const viteResolverPlugin = createViteLessPlugin(
    nodeLess,
    options.filename,
    options.alias,
    resolvers
  )
  source = await getSource(source, options.filename, options.additionalData)

  let result: Less.RenderOutput | undefined
  try {
    result = await nodeLess.render(source, {
      ...options,
      plugins: [viteResolverPlugin, ...(options.plugins || [])]
    })
  } catch (e) {
    const error = e as Less.RenderError
    // normalize error info
    const normalizedError: RollupError = new Error(error.message || error.type)
    normalizedError.loc = {
      file: error.filename || options.filename,
      line: error.line,
      column: error.column
    }
    return { code: '', errors: [normalizedError], deps: [] }
  }
  return {
    code: result.css.toString(),
    deps: result.imports,
    errors: []
  }
}

/**
 * Less manager, lazy initialized
 */
let ViteLessManager: any

function createViteLessPlugin(
  less: typeof Less,
  rootFile: string,
  alias: Alias[],
  resolvers: CSSAtImportResolvers
): Less.Plugin {
  if (!ViteLessManager) {
    ViteLessManager = class ViteManager extends less.FileManager {
      resolvers
      rootFile
      alias
      constructor(
        rootFile: string,
        resolvers: CSSAtImportResolvers,
        alias: Alias[]
      ) {
        super()
        this.rootFile = rootFile
        this.resolvers = resolvers
        this.alias = alias
      }
      override supports() {
        return true
      }
      override supportsSync() {
        return false
      }
      override async loadFile(
        filename: string,
        dir: string,
        opts: any,
        env: any
      ): Promise<Less.FileLoadResult> {
        const resolved = await this.resolvers.less(
          filename,
          path.join(dir, '*')
        )
        if (resolved) {
          const result = await rebaseUrls(resolved, this.rootFile, this.alias)
          let contents
          if (result && 'contents' in result) {
            contents = result.contents
          } else {
            contents = fs.readFileSync(resolved, 'utf-8')
          }
          return {
            filename: path.resolve(resolved),
            contents
          }
        } else {
          return super.loadFile(filename, dir, opts, env)
        }
      }
    }
  }

  return {
    install(_, pluginManager) {
      pluginManager.addFileManager(
        new ViteLessManager(rootFile, resolvers, alias)
      )
    },
    minVersion: [3, 0, 0]
  }
}

// .styl
const styl: StylePreprocessor = async (source, root, options) => {
  const nodeStylus = loadPreprocessor(PreprocessLang.stylus, root)
  // Get source with preprocessor options.additionalData. Make sure a new line separator
  // is added to avoid any render error, as added stylus content may not have semi-colon separators
  source = await getSource(
    source,
    options.filename,
    options.additionalData,
    '\n'
  )
  // Get preprocessor options.imports dependencies as stylus
  // does not return them with its builtin `.deps()` method
  const importsDeps = (options.imports ?? []).map((dep: string) =>
    path.resolve(dep)
  )
  try {
    const ref = nodeStylus(source, options)

    // if (map) ref.set('sourcemap', { inline: false, comment: false })

    const result = ref.render()

    // Concat imports deps with computed deps
    const deps = [...ref.deps(), ...importsDeps]

    return { code: result, errors: [], deps }
  } catch (e) {
    return { code: '', errors: [e], deps: [] }
  }
}

function getSource(
  source: string,
  filename: string,
  additionalData?: PreprocessorAdditionalData,
  sep: string = ''
): string | Promise<string> {
  if (!additionalData) return source
  if (typeof additionalData === 'function') {
    return additionalData(source, filename)
  }
  return additionalData + sep + source
}

const preProcessors = Object.freeze({
  [PreprocessLang.less]: less,
  [PreprocessLang.sass]: sass,
  [PreprocessLang.scss]: scss,
  [PreprocessLang.styl]: styl,
  [PreprocessLang.stylus]: styl
})

function isPreProcessor(lang: any): lang is PreprocessLang {
  return lang && lang in preProcessors
}
