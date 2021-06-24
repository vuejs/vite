import path from 'path'
import { Loader, Plugin, ImportKind } from 'esbuild'
import { KNOWN_ASSET_TYPES } from '../constants'
import { ResolvedConfig } from '..'
import {
  isRunningWithYarnPnp,
  flattenId,
  normalizePath,
  isExternalUrl
} from '../utils'
import { browserExternalId } from '../plugins/resolve'
import { ExportsData } from '.'

const externalTypes = [
  'css',
  // supported pre-processor types
  'less',
  'sass',
  'scss',
  'styl',
  'stylus',
  'pcss',
  'postcss',
  // known SFC types
  'vue',
  'svelte',
  'marko',
  // JSX/TSX may be configured to be compiled differently from how esbuild
  // handles it by default, so exclude them as well
  'jsx',
  'tsx',
  ...KNOWN_ASSET_TYPES
]

export function esbuildDepPlugin(
  qualified: Record<string, string>,
  exportsData: Record<string, ExportsData>,
  config: ResolvedConfig
): Plugin {
  // default resolver which prefers ESM
  const _resolve = config.createResolver({ asSrc: false })

  // cjs resolver that prefers Node
  const _resolveRequire = config.createResolver({
    asSrc: false,
    isRequire: true
  })

  const resolve = (
    id: string,
    importer: string,
    kind: ImportKind,
    resolveDir?: string
  ): Promise<string | undefined> => {
    let _importer
    // explicit resolveDir - this is passed only during yarn pnp resolve for
    // entries
    if (resolveDir) {
      _importer = normalizePath(path.join(resolveDir, '*'))
    } else {
      // map importer ids to file paths for correct resolution
      _importer = importer in qualified ? qualified[importer] : importer
    }
    const resolver = kind.startsWith('require') ? _resolveRequire : _resolve
    return resolver(id, _importer)
  }

  return {
    name: 'vite:dep-pre-bundle',
    setup(build) {
      // externalize assets and commonly known non-js file types
      build.onResolve(
        {
          filter: new RegExp(`\\.(` + externalTypes.join('|') + `)(\\?.*)?$`)
        },
        async ({ path: id, importer, kind }) => {
          const resolved = await resolve(id, importer, kind)
          if (resolved) {
            return {
              path: resolved,
              external: true
            }
          }
        }
      )

      function resolveEntry(id: string, isEntry: boolean, resolveDir: string) {
        const flatId = flattenId(id)
        if (flatId in qualified) {
          return isEntry
            ? {
                path: flatId,
                namespace: 'dep'
              }
            : {
                path: require.resolve(qualified[flatId], {
                  paths: [resolveDir]
                })
              }
        }
      }

      build.onResolve(
        { filter: /^[\w@][^:]/ },
        async ({ path: id, importer, kind, resolveDir }) => {
          const isEntry = !importer
          // ensure esbuild uses our resolved entries
          let entry
          // if this is an entry, return entry namespace resolve result
          if ((entry = resolveEntry(id, isEntry, resolveDir))) return entry

          // check if this is aliased to an entry - also return entry namespace
          const aliased = await _resolve(id, undefined, true)
          if (aliased && (entry = resolveEntry(aliased, isEntry, resolveDir))) {
            return entry
          }

          // use vite's own resolver
          const resolved = await resolve(id, importer, kind)
          if (resolved) {
            if (resolved.startsWith(browserExternalId)) {
              return {
                path: id,
                namespace: 'browser-external'
              }
            }
            if (isExternalUrl(resolved)) {
              return {
                path: resolved,
                external: true
              }
            }
            return {
              path: path.resolve(resolved)
            }
          }
        }
      )

      // For entry files, we'll read it ourselves and construct a proxy module
      // to retain the entry's raw id instead of file path so that esbuild
      // outputs desired output file structure.
      // It is necessary to do the re-exporting to separate the virtual proxy
      // module from the actual module since the actual module may get
      // referenced via relative imports - if we don't separate the proxy and
      // the actual module, esbuild will create duplicated copies of the same
      // module!
      const root = path.resolve(config.root)
      build.onLoad({ filter: /.*/, namespace: 'dep' }, ({ path: id }) => {
        const entryFile = qualified[id]

        let relativePath = normalizePath(path.relative(root, entryFile))
        if (!relativePath.startsWith('./')) {
          relativePath = `./${relativePath}`
        }

        let contents = ''
        const data = exportsData[id]
        const [imports, exports] = data
        if (!imports.length && !exports.length) {
          // cjs
          contents += `export default require("${relativePath}");`
        } else {
          if (exports.includes('default')) {
            contents += `import d from "${relativePath}";export default d;`
          }
          if (
            data.hasReExports ||
            exports.length > 1 ||
            exports[0] !== 'default'
          ) {
            contents += `\nexport * from "${relativePath}"`
          }
        }

        let ext = path.extname(entryFile).slice(1)
        if (ext === 'mjs') ext = 'js'
        return {
          loader: ext as Loader,
          contents,
          resolveDir: root
        }
      })

      build.onLoad(
        { filter: /.*/, namespace: 'browser-external' },
        ({ path: id }) => {
          return {
            contents:
              `export default new Proxy({}, {
  get() {
    throw new Error('Module "${id}" has been externalized for ` +
              `browser compatibility and cannot be accessed in client code.')
  }
})`
          }
        }
      )

      // yarn 2 pnp compat
      if (isRunningWithYarnPnp) {
        build.onResolve(
          { filter: /.*/ },
          async ({ path, importer, kind, resolveDir }) => ({
            // pass along resolveDir for entries
            path: await resolve(path, importer, kind, resolveDir)
          })
        )
        build.onLoad({ filter: /.*/ }, async (args) => ({
          contents: await require('fs').promises.readFile(args.path),
          loader: 'default'
        }))
      }
    }
  }
}
