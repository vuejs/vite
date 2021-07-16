// @ts-check
const path = require('path')
const { createHash } = require('crypto')
const { build } = require('vite')
const MagicString = require('magic-string').default

// lazy load babel since it's not used during dev
let babel
/**
 * @return {import('@babel/standalone')}
 */
const loadBabel = () => babel || (babel = require('@babel/standalone'))

// https://gist.github.com/samthor/64b114e4a4f539915a95b91ffd340acc
// DO NOT ALTER THIS CONTENT
const safari10NoModuleFix = `!function(){var e=document,t=e.createElement("script");if(!("noModule"in t)&&"onbeforeload"in t){var n=!1;e.addEventListener("beforeload",(function(e){if(e.target===t)n=!0;else if(!e.target.hasAttribute("nomodule")||!n)return;e.preventDefault()}),!0),t.type="module",t.src=".",e.head.appendChild(t),t.remove()}}();`

const legacyEntryId = 'vite-legacy-entry'
const systemJSInlineCode = `System.import(document.getElementById('${legacyEntryId}').getAttribute('data-src'))`

const legacyEnvVarMarker = `__VITE_IS_LEGACY__`

/**
 * @param {import('.').Options} options
 * @returns {import('vite').Plugin[]}
 */
function viteLegacyPlugin(options = {}) {
  /**
   * @type {import('vite').ResolvedConfig}
   */
  let config
  const targets = options.targets || 'defaults'
  const genLegacy = options.renderLegacyChunks !== false

  const debugFlag = process.env.DEBUG
  const isDebug = debugFlag === 'vite:*' || debugFlag === 'vite:legacy'

  const facadeToLegacyChunkMap = new Map()
  const facadeToLegacyPolyfillMap = new Map()
  const facadeToModernPolyfillMap = new Map()
  const modernPolyfills = new Set()
  const legacyPolyfills = new Set()

  if (Array.isArray(options.modernPolyfills)) {
    options.modernPolyfills.forEach((i) => {
      modernPolyfills.add(
        i.includes('/') ? `core-js/${i}` : `core-js/modules/${i}.js`
      )
    })
  }
  if (Array.isArray(options.polyfills)) {
    options.polyfills.forEach((i) => {
      if (i.startsWith(`regenerator`)) {
        legacyPolyfills.add(`regenerator-runtime/runtime.js`)
      } else {
        legacyPolyfills.add(
          i.includes('/') ? `core-js/${i}` : `core-js/modules/${i}.js`
        )
      }
    })
  }
  if (Array.isArray(options.additionalLegacyPolyfills)) {
    options.additionalLegacyPolyfills.forEach((i) => {
      legacyPolyfills.add(i)
    })
  }

  /**
   * @type {import('vite').Plugin}
   */
  const legacyConfigPlugin = {
    name: 'legacy-config',

    apply: 'build',
    config(config) {
      if (!config.build) {
        config.build = {}
      }
      if (genLegacy) {
        config.build.polyfillDynamicImport = true
      }
    }
  }

  /**
   * @type {import('vite').Plugin}
   */
  const legacyGenerateBundlePlugin = {
    name: 'legacy-generate-polyfill-chunk',
    apply: 'build',

    configResolved(config) {
      if (config.build.minify === 'esbuild') {
        throw new Error(
          `Can't use esbuild as the minifier when targeting legacy browsers ` +
            `because esbuild minification is not legacy safe.`
        )
      }
    },

    async generateBundle(opts, bundle) {
      if (!isLegacyBundle(bundle, opts)) {
        if (!modernPolyfills.size) {
          return
        }
        isDebug &&
          console.log(
            `[@vitejs/plugin-legacy] modern polyfills:`,
            modernPolyfills
          )
        await buildPolyfillChunk(
          'polyfills-modern',
          modernPolyfills,
          bundle,
          facadeToModernPolyfillMap,
          config.build
        )
        return
      }

      if (!genLegacy) {
        return
      }

      // legacy bundle
      if (legacyPolyfills.size) {
        if (!legacyPolyfills.has('es.promise')) {
          // check if the target needs Promise polyfill because SystemJS relies
          // on it
          detectPolyfills(`Promise.resolve()`, targets, legacyPolyfills)
        }

        isDebug &&
          console.log(
            `[@vitejs/plugin-legacy] legacy polyfills:`,
            legacyPolyfills
          )

        await buildPolyfillChunk(
          'polyfills-legacy',
          legacyPolyfills,
          bundle,
          facadeToLegacyPolyfillMap,
          // force using terser for legacy polyfill minification, since esbuild
          // isn't legacy-safe
          config.build
        )
      }
    }
  }

  /**
   * @type {import('vite').Plugin}
   */
  const legacyPostPlugin = {
    name: 'legacy-post-process',
    enforce: 'post',
    apply: 'build',

    configResolved(_config) {
      if (_config.build.lib) {
        throw new Error('@vitejs/plugin-legacy does not support library mode.')
      }
      config = _config

      if (!genLegacy) {
        return
      }

      /**
       * @param {string | ((chunkInfo: import('rollup').PreRenderedChunk) => string)} fileNames
       * @param {string?} defaultFileName
       * @returns {(chunkInfo: import('rollup').PreRenderedChunk) => string)}
       */
      const getLegacyOutputFileName = (
        fileNames,
        defaultFileName = '[name]-legacy.[hash].js'
      ) => {
        if (!fileNames) {
          return path.posix.join(config.build.assetsDir, defaultFileName)
        }

        return (chunkInfo) => {
          let fileName =
            typeof fileNames === 'function' ? fileNames(chunkInfo) : fileNames

          if (fileName.includes('[name]')) {
            // [name]-[hash].[format] -> [name]-legacy-[hash].[format]
            fileName = fileName.replace('[name]', '[name]-legacy')
          } else {
            // entry.js -> entry-legacy.js
            fileName = fileName.replace(/(.+)\.(.+)/, '$1-legacy.$2')
          }

          return fileName
        }
      }

      /**
       * @param {import('rollup').OutputOptions} options
       * @returns {import('rollup').OutputOptions}
       */
      const createLegacyOutput = (options = {}) => {
        return {
          ...options,
          format: 'system',
          entryFileNames: getLegacyOutputFileName(options.entryFileNames),
          chunkFileNames: getLegacyOutputFileName(options.chunkFileNames)
        }
      }

      const { rollupOptions } = config.build
      const { output } = rollupOptions
      if (Array.isArray(output)) {
        rollupOptions.output = [...output.map(createLegacyOutput), ...output]
      } else {
        rollupOptions.output = [createLegacyOutput(output), output || {}]
      }
    },

    renderChunk(raw, chunk, opts) {
      if (!isLegacyChunk(chunk, opts)) {
        if (
          options.modernPolyfills &&
          !Array.isArray(options.modernPolyfills)
        ) {
          // analyze and record modern polyfills
          detectPolyfills(raw, { esmodules: true }, modernPolyfills)
        }

        if (raw.includes(legacyEnvVarMarker)) {
          const re = new RegExp(legacyEnvVarMarker, 'g')
          if (config.build.sourcemap) {
            const s = new MagicString(raw)
            let match
            while ((match = re.exec(raw))) {
              s.overwrite(
                match.index,
                match.index + legacyEnvVarMarker.length,
                `false`
              )
            }
            return {
              code: s.toString(),
              map: s.generateMap({ hires: true })
            }
          } else {
            return raw.replace(re, `false`)
          }
        }

        return null
      }

      if (!genLegacy) {
        return
      }

      // @ts-ignore avoid esbuild transform on legacy chunks since it produces
      // legacy-unsafe code - e.g. rewriting object properties into shorthands
      opts.__vite_skip_esbuild__ = true
      // @ts-ignore
      // inject flag to prevent emit assets for legacy bundle
      opts.__vite_legacy = true

      const needPolyfills =
        options.polyfills !== false && !Array.isArray(options.polyfills)

      // transform the legacy chunk with @babel/preset-env
      const sourceMaps = !!config.build.sourcemap
      const { code, map } = loadBabel().transform(raw, {
        babelrc: false,
        configFile: false,
        compact: true,
        sourceMaps,
        inputSourceMap: sourceMaps && chunk.map,
        presets: [
          // forcing our plugin to run before preset-env by wrapping it in a
          // preset so we can catch the injected import statements...
          [
            () => ({
              plugins: [
                recordAndRemovePolyfillBabelPlugin(legacyPolyfills),
                replaceLegacyEnvBabelPlugin(),
                wrapIIFEBabelPlugin()
              ]
            })
          ],
          [
            'env',
            {
              targets,
              modules: false,
              bugfixes: true,
              loose: false,
              useBuiltIns: needPolyfills ? 'usage' : false,
              corejs: needPolyfills
                ? { version: 3, proposals: false }
                : undefined,
              shippedProposals: true,
              ignoreBrowserslistConfig: options.ignoreBrowserslistConfig
            }
          ]
        ]
      })

      return { code, map }
    },

    transformIndexHtml(html, { chunk }) {
      if (!chunk) return
      if (chunk.fileName.includes('-legacy')) {
        // The legacy bundle is built first, and its index.html isn't actually
        // emitted. Here we simply record its corresponding legacy chunk.
        facadeToLegacyChunkMap.set(chunk.facadeModuleId, chunk.fileName)
        return
      }

      /**
       * @type {import('vite').HtmlTagDescriptor[]}
       */
      const tags = []
      const htmlFilename = chunk.facadeModuleId.replace(/\?.*$/, '')

      // 1. inject modern polyfills
      const modernPolyfillFilename = facadeToModernPolyfillMap.get(
        chunk.facadeModuleId
      )
      if (modernPolyfillFilename) {
        tags.push({
          tag: 'script',
          attrs: {
            type: 'module',
            src: `${config.base}${modernPolyfillFilename}`
          }
        })
      } else if (modernPolyfills.size) {
        throw new Error(
          `No corresponding modern polyfill chunk found for ${htmlFilename}`
        )
      }

      if (!genLegacy) {
        return { html, tags }
      }

      // 2. inject Safari 10 nomodule fix
      tags.push({
        tag: 'script',
        attrs: { nomodule: true },
        children: safari10NoModuleFix,
        injectTo: 'body'
      })

      // 3. inject legacy polyfills
      const legacyPolyfillFilename = facadeToLegacyPolyfillMap.get(
        chunk.facadeModuleId
      )
      if (legacyPolyfillFilename) {
        tags.push({
          tag: 'script',
          attrs: {
            nomodule: true,
            src: `${config.base}${legacyPolyfillFilename}`
          },
          injectTo: 'body'
        })
      } else if (legacyPolyfills.size) {
        throw new Error(
          `No corresponding legacy polyfill chunk found for ${htmlFilename}`
        )
      }

      // 4. inject legacy entry
      const legacyEntryFilename = facadeToLegacyChunkMap.get(
        chunk.facadeModuleId
      )
      if (legacyEntryFilename) {
        tags.push({
          tag: 'script',
          attrs: {
            nomodule: true,
            // we set the entry path on the element as an attribute so that the
            // script content will stay consistent - which allows using a constant
            // hash value for CSP.
            id: legacyEntryId,
            'data-src': config.base + legacyEntryFilename
          },
          children: systemJSInlineCode,
          injectTo: 'body'
        })
      } else {
        throw new Error(
          `No corresponding legacy entry chunk found for ${htmlFilename}`
        )
      }

      return {
        html,
        tags
      }
    },

    generateBundle(opts, bundle) {
      if (isLegacyBundle(bundle, opts)) {
        // avoid emitting duplicate assets
        for (const name in bundle) {
          if (bundle[name].type === 'asset') {
            delete bundle[name]
          }
        }
      }
    }
  }

  let envInjectionFailed = false
  /**
   * @type {import('vite').Plugin}
   */
  const legacyEnvPlugin = {
    name: 'legacy-env',

    config(_, env) {
      if (env) {
        return {
          define: {
            'import.meta.env.LEGACY':
              env.command === 'serve' ? false : legacyEnvVarMarker
          }
        }
      } else {
        envInjectionFailed = true
      }
    },

    configResolved(config) {
      if (envInjectionFailed) {
        config.logger.warn(
          `[@vitejs/plugin-legacy] import.meta.env.LEGACY was not injected due ` +
            `to incompatible vite version (requires vite@^2.0.0-beta.69).`
        )
      }
    }
  }

  return [
    legacyConfigPlugin,
    legacyGenerateBundlePlugin,
    legacyPostPlugin,
    legacyEnvPlugin
  ]
}

/**
 * @param {string} code
 * @param {any} targets
 * @param {Set<string>} list
 */
function detectPolyfills(code, targets, list) {
  const { ast } = loadBabel().transform(code, {
    ast: true,
    babelrc: false,
    configFile: false,
    presets: [
      [
        'env',
        {
          targets,
          modules: false,
          useBuiltIns: 'usage',
          corejs: { version: 3, proposals: false },
          shippedProposals: true,
          ignoreBrowserslistConfig: true
        }
      ]
    ]
  })
  for (const node of ast.program.body) {
    if (node.type === 'ImportDeclaration') {
      const source = node.source.value
      if (
        source.startsWith('core-js/') ||
        source.startsWith('regenerator-runtime/')
      ) {
        list.add(source)
      }
    }
  }
}

/**
 * @param {string} name
 * @param {Set<string>} imports
 * @param {import('rollup').OutputBundle} bundle
 * @param {Map<string, string>} facadeToChunkMap
 * @param {import('vite').BuildOptions} buildOptions
 */
async function buildPolyfillChunk(
  name,
  imports,
  bundle,
  facadeToChunkMap,
  buildOptions
) {
  let { minify, assetsDir } = buildOptions
  minify = minify ? 'terser' : false
  const res = await build({
    // so that everything is resolved from here
    root: __dirname,
    configFile: false,
    logLevel: 'error',
    plugins: [polyfillsPlugin(imports)],
    build: {
      write: false,
      target: false,
      minify,
      assetsDir,
      rollupOptions: {
        input: {
          [name]: polyfillId
        },
        output: {
          format: name.includes('legacy') ? 'iife' : 'es',
          manualChunks: undefined
        }
      }
    }
  })
  const polyfillChunk = (Array.isArray(res) ? res[0] : res).output[0]

  // associate the polyfill chunk to every entry chunk so that we can retrieve
  // the polyfill filename in index html transform
  for (const key in bundle) {
    const chunk = bundle[key]
    if (chunk.type === 'chunk' && chunk.facadeModuleId) {
      facadeToChunkMap.set(chunk.facadeModuleId, polyfillChunk.fileName)
    }
  }

  // add the chunk to the bundle
  bundle[polyfillChunk.name] = polyfillChunk
}

const polyfillId = 'vite/legacy-polyfills'

/**
 * @param {Set<string>} imports
 * @return {import('rollup').Plugin}
 */
function polyfillsPlugin(imports) {
  return {
    name: 'polyfills',
    resolveId(id) {
      if (id === polyfillId) {
        return id
      }
    },
    load(id) {
      if (id === polyfillId) {
        return (
          [...imports].map((i) => `import "${i}";`).join('') +
          `import "systemjs/dist/s.min.js";`
        )
      }
    }
  }
}

/**
 * @param {import('rollup').RenderedChunk} chunk
 * @param {import('rollup').NormalizedOutputOptions} options
 */
function isLegacyChunk(chunk, options) {
  return options.format === 'system' && chunk.fileName.includes('-legacy')
}

/**
 * @param {import('rollup').OutputBundle} bundle
 * @param {import('rollup').NormalizedOutputOptions} options
 */
function isLegacyBundle(bundle, options) {
  if (options.format === 'system') {
    const entryChunk = Object.values(bundle).find(
      (output) => output.type === 'chunk' && output.isEntry
    )

    return !!entryChunk && entryChunk.fileName.includes('-legacy')
  }

  return false
}

/**
 * @param {Set<string>} polyfills
 */
function recordAndRemovePolyfillBabelPlugin(polyfills) {
  return ({ types: t }) => ({
    name: 'vite-remove-polyfill-import',
    post({ path }) {
      path.get('body').forEach((p) => {
        if (t.isImportDeclaration(p)) {
          polyfills.add(p.node.source.value)
          p.remove()
        }
      })
    }
  })
}

function replaceLegacyEnvBabelPlugin() {
  return ({ types: t }) => ({
    name: 'vite-replace-env-legacy',
    visitor: {
      Identifier(path) {
        if (path.node.name === legacyEnvVarMarker) {
          path.replaceWith(t.booleanLiteral(true))
        }
      }
    }
  })
}

function wrapIIFEBabelPlugin() {
  return ({ types: t, template }) => {
    const buildIIFE = template(';(function(){%%body%%})();')

    return {
      name: 'vite-wrap-iife',
      post({ path }) {
        if (!this.isWrapped) {
          this.isWrapped = true
          path.replaceWith(t.program(buildIIFE({ body: path.node.body })))
        }
      }
    }
  }
}

module.exports = viteLegacyPlugin

viteLegacyPlugin.default = viteLegacyPlugin

viteLegacyPlugin.cspHashes = [
  createHash('sha256').update(safari10NoModuleFix).digest('base64'),
  createHash('sha256').update(systemJSInlineCode).digest('base64')
]
