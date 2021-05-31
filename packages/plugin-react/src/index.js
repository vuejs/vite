// @ts-check
import babel from '@babel/core'
import { createFilter } from '@rollup/pluginutils'
import viteReactJsx, { babelImportToRequire } from 'vite-react-jsx'
import {
  addRefreshWrapper,
  isRefreshBoundary,
  preambleCode,
  runtimeCode,
  runtimePublicPath
} from './fast-refresh.js'

/**
 * @param {import('./').Options} opts
 */
export default function viteReact(opts = {}) {
  let base = '/'
  let projectRoot = process.cwd()
  let isProduction = true
  let skipFastRefresh = opts.fastRefresh === false
  let filter

  const userPlugins = opts.babel?.plugins || []
  const userParserPlugins =
    opts.parserPlugins || opts.babel?.parserOpts?.plugins || []

  /** @type {import('vite').Plugin} */
  const viteBabel = {
    name: 'vite:babel',
    enforce: 'pre',
    async transform(code, id, ssr) {
      if (/\.[tj]sx?$/.test(id)) {
        const plugins = [...userPlugins]

        /** @type {typeof userParserPlugins} */
        const parserPlugins = [
          ...userParserPlugins,
          'jsx',
          'importMeta',
          // This plugin is applied before esbuild transforms the code,
          // so we need to enable some stage 3 syntax that is supported in
          // TypeScript and some environments already.
          'topLevelAwait',
          'classProperties',
          'classPrivateProperties',
          'classPrivateMethods'
        ]

        const isTypeScript = /\.tsx?$/.test(id)
        if (isTypeScript) {
          // TODO: maybe we need to read tsconfig to determine parser plugins to
          // enable here, but allowing decorators by default since it's very
          // commonly used with TS.
          parserPlugins.push('typescript', 'decorators-legacy')
        }

        const isNodeModules = id.includes('node_modules')
        if (!isNodeModules && !isProduction) {
          plugins.push(
            await interopDefault(
              import('@babel/plugin-transform-react-jsx-self')
            ),
            await interopDefault(
              import('@babel/plugin-transform-react-jsx-source')
            )
          )
        }

        let useFastRefresh = false
        if (!skipFastRefresh && !ssr && !isNodeModules) {
          // Modules with .js or .ts extension must import React.
          const isReactModule = id.endsWith('x') || code.includes('react')
          if (isReactModule && filter(id)) {
            useFastRefresh = true
            plugins.push([
              await import('react-refresh/babel'),
              { skipEnvCheck: true }
            ])
          }
        }

        let ast
        if (id.endsWith('x')) {
          if (opts.jsxRuntime === 'automatic') {
            const [restoredAst, isCommonJS] = isNodeModules
              ? await viteReactJsx.restoreJSX(babel, code)
              : [null, false]

            ast = restoredAst

            plugins.push([
              await import('@babel/plugin-transform-react-jsx'),
              { runtime: 'automatic' }
            ])

            // Avoid inserting `import` statements into CJS modules.
            if (isCommonJS) {
              plugins.push(babelImportToRequire)
            }
          }
          // Even if the automatic JSX runtime is not used, we can still
          // inject the React import for .jsx and .tsx modules.
          else if (!isNodeModules && !/(^|\n)import React /.test(code)) {
            code = `import React from 'react'; ` + code
          }
        }

        const isReasonReact = id.endsWith('.bs.js')

        /** @type {import('@babel/core').TransformOptions} */
        const babelOpts = {
          babelrc: false,
          configFile: false,
          ...opts.babel,
          ast: !isReasonReact,
          root: projectRoot,
          filename: id,
          parserOpts: {
            ...opts.babel?.parserOpts,
            sourceType: 'module',
            allowAwaitOutsideFunction: true,
            plugins: parserPlugins
          },
          generatorOpts: {
            ...opts.babel?.generatorOpts,
            decoratorsBeforeExport: true
          },
          plugins,
          sourceMaps: true,
          sourceFileName: id
        }

        const result = ast
          ? await babel.transformFromAstAsync(ast, code, babelOpts)
          : await babel.transformAsync(code, babelOpts)

        if (result) {
          if (useFastRefresh && /\$RefreshReg\$\(/.test(result.code)) {
            const accept = isReasonReact || isRefreshBoundary(result.ast)
            result.code = addRefreshWrapper(result.code, id, accept)
          }
          return {
            code: result.code,
            map: result.map
          }
        }
      }
    }
  }

  /** @type {import('vite').Plugin} */
  const viteReactRefresh = {
    name: 'vite:react-refresh',
    enforce: 'pre',
    config: () => ({
      resolve: {
        dedupe: ['react', 'react-dom']
      }
    }),
    configResolved(config) {
      base = config.base
      projectRoot = config.root
      isProduction = config.isProduction
      skipFastRefresh = isProduction || config.command === 'build'
      filter = createFilter(opts.include, opts.exclude, {
        resolve: projectRoot
      })

      config.plugins.forEach(
        (plugin) =>
          (plugin.name === 'react-refresh' ||
            plugin.name === 'vite:react-jsx') &&
          config.logger.warn(
            `[@vitejs/plugin-react] This plugin conflicts with "${plugin.name}". Please remove it.`
          )
      )
    },
    resolveId(id) {
      if (id === runtimePublicPath) {
        return id
      }
    },
    load(id) {
      if (id === runtimePublicPath) {
        return runtimeCode
      }
    },
    transformIndexHtml() {
      if (!skipFastRefresh)
        return [
          {
            tag: 'script',
            attrs: { type: 'module' },
            children: preambleCode.replace(`__BASE__`, base)
          }
        ]
    }
  }

  return [
    viteBabel,
    viteReactRefresh,
    opts.jsxRuntime === 'automatic' &&
      viteReactJsx.getRuntimeLoader({
        get root() {
          return projectRoot
        }
      })
  ]
}

viteReact.preambleCode = preambleCode

function interopDefault(promise) {
  return promise.then((module) => module.default || module)
}
