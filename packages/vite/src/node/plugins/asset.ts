import path from 'path'
import { parse as parseUrl } from 'url'
import fs, { promises as fsp } from 'fs'
import mime from 'mime/lite'
import { Plugin } from '../plugin'
import { ResolvedConfig } from '../config'
import { cleanUrl } from '../utils'
import { FS_PREFIX } from '../constants'
import { PluginContext, RenderedChunk } from 'rollup'
import MagicString from 'magic-string'
import { createHash } from 'crypto'

export const assetUrlRE = /__VITE_ASSET__([a-z\d]{8})__(?:\$_(.*?)__)?/g

// urls in JS must be quoted as strings, so when replacing them we need
// a different regex
const assetUrlQuotedRE = /"__VITE_ASSET__([a-z\d]{8})__(?:\$_(.*?)__)?"/g

const rawRE = /(\?|&)raw(?:&|$)/
const urlRE = /(\?|&)url(?:&|$)/

export const chunkToEmittedAssetsMap = new WeakMap<RenderedChunk, Set<string>>()

const assetCache = new WeakMap<ResolvedConfig, Map<string, string>>()

const assetHashToFilenameMap = new WeakMap<
  ResolvedConfig,
  Map<string, string>
>()
// save hashes of the files that has been emitted in build watch
const emittedHashMap = new WeakMap<ResolvedConfig, Set<string>>()

/**
 * Also supports loading plain strings with import text from './foo.txt?raw'
 */
export function assetPlugin(config: ResolvedConfig): Plugin {
  // assetHashToFilenameMap initialization in buildStart causes getAssetFilename to return undefined
  assetHashToFilenameMap.set(config, new Map())
  return {
    name: 'vite:asset',

    buildStart() {
      assetCache.set(config, new Map())
      emittedHashMap.set(config, new Set())
    },

    resolveId(id) {
      if (!config.assetsInclude(cleanUrl(id))) {
        return
      }
      // imports to absolute urls pointing to files in /public
      // will fail to resolve in the main resolver. handle them here.
      const publicFile = checkPublicFile(id, config)
      if (publicFile) {
        return id
      }
    },

    async load(id) {
      if (id.startsWith('\0')) {
        // Rollup convention, this id should be handled by the
        // plugin that marked it with \0
        return
      }

      // raw requests, read from disk
      if (rawRE.test(id)) {
        const file = checkPublicFile(id, config) || cleanUrl(id)
        // raw query, read file and return as string
        return `export default ${JSON.stringify(
          await fsp.readFile(file, 'utf-8')
        )}`
      }

      if (!config.assetsInclude(cleanUrl(id)) && !urlRE.test(id)) {
        return
      }

      id = id.replace(urlRE, '$1').replace(/[\?&]$/, '')
      const url = await fileToUrl(id, config, this)
      return `export default ${JSON.stringify(url)}`
    },

    renderChunk(code, chunk) {
      let match
      let s
      while ((match = assetUrlQuotedRE.exec(code))) {
        s = s || (s = new MagicString(code))
        const [full, hash, postfix = ''] = match
        // some internal plugins may still need to emit chunks (e.g. worker) so
        // fallback to this.getFileName for that.
        const file = getAssetFilename(hash, config) || this.getFileName(hash)
        registerAssetToChunk(chunk, file)
        const outputFilepath = config.base + file + postfix
        s.overwrite(
          match.index,
          match.index + full.length,
          JSON.stringify(outputFilepath)
        )
      }
      if (s) {
        return {
          code: s.toString(),
          map: config.build.sourcemap ? s.generateMap({ hires: true }) : null
        }
      } else {
        return null
      }
    },

    generateBundle(_, bundle) {
      // do not emit assets for SSR build
      if (config.command === 'build' && config.build.ssr) {
        for (const file in bundle) {
          if (
            bundle[file].type === 'asset' &&
            !file.includes('ssr-manifest.json')
          ) {
            delete bundle[file]
          }
        }
      }
    }
  }
}

export function registerAssetToChunk(chunk: RenderedChunk, file: string): void {
  let emitted = chunkToEmittedAssetsMap.get(chunk)
  if (!emitted) {
    emitted = new Set()
    chunkToEmittedAssetsMap.set(chunk, emitted)
  }
  emitted.add(cleanUrl(file))
}

export function checkPublicFile(
  url: string,
  { publicDir }: ResolvedConfig
): string | undefined {
  // note if the file is in /public, the resolver would have returned it
  // as-is so it's not going to be a fully resolved path.
  if (!publicDir || !url.startsWith('/')) {
    return
  }
  const publicFile = path.join(publicDir, cleanUrl(url))
  if (fs.existsSync(publicFile)) {
    return publicFile
  } else {
    return
  }
}

export function fileToUrl(
  id: string,
  config: ResolvedConfig,
  ctx: PluginContext
): string | Promise<string> {
  if (config.command === 'serve') {
    return fileToDevUrl(id, config)
  } else {
    return fileToBuiltUrl(id, config, ctx)
  }
}

function fileToDevUrl(id: string, config: ResolvedConfig) {
  let rtn: string
  if (checkPublicFile(id, config)) {
    // in public dir, keep the url as-is
    rtn = id
  } else if (id.startsWith(config.root)) {
    // in project root, infer short public path
    rtn = '/' + path.posix.relative(config.root, id)
  } else {
    // outside of project root, use absolute fs path
    // (this is special handled by the serve static middleware
    rtn = path.posix.join(FS_PREFIX + id)
  }
  return config.base + rtn.replace(/^\//, '')
}

export function getAssetFilename(
  hash: string,
  config: ResolvedConfig
): string | undefined {
  return assetHashToFilenameMap.get(config)?.get(hash)
}

/**
 * Register an asset to be emitted as part of the bundle (if necessary)
 * and returns the resolved public URL
 */
async function fileToBuiltUrl(
  id: string,
  config: ResolvedConfig,
  pluginContext: PluginContext,
  skipPublicCheck = false
): Promise<string> {
  if (!skipPublicCheck && checkPublicFile(id, config)) {
    return config.base + id.slice(1)
  }

  const cache = assetCache.get(config)!
  const cached = cache.get(id)
  if (cached) {
    return cached
  }

  const file = cleanUrl(id)
  const content = await fsp.readFile(file)

  let url
  if (
    config.build.lib ||
    (!file.endsWith('.svg') &&
      content.length < Number(config.build.assetsInlineLimit))
  ) {
    // base64 inlined as a string
    url = `data:${mime.getType(file)};base64,${content.toString('base64')}`
  } else {
    // emit as asset
    // rollup supports `import.meta.ROLLUP_FILE_URL_*`, but it generates code
    // that uses runtime url sniffing and it can be verbose when targeting
    // non-module format. It also fails to cascade the asset content change
    // into the chunk's hash, so we have to do our own content hashing here.
    // https://bundlers.tooling.report/hashing/asset-cascade/
    // https://github.com/rollup/rollup/issues/3415
    const map = assetHashToFilenameMap.get(config)!
    const contentHash = getAssetHash(content)
    const { search, hash } = parseUrl(id)
    const postfix = (search || '') + (hash || '')
    const basename = path.basename(file)
    const ext = path.extname(basename)
    const fileName = path.posix.join(
      config.build.assetsDir,
      `${basename.slice(0, -ext.length)}.${contentHash}${ext}`
    )
    if (!map.has(contentHash)) {
      map.set(contentHash, fileName)
    }
    const emittedSet = emittedHashMap.get(config)!
    if (!emittedSet.has(contentHash)) {
      pluginContext.emitFile({
        fileName,
        type: 'asset',
        source: content
      })
      emittedSet.add(contentHash)
    }

    url = `__VITE_ASSET__${contentHash}__${postfix ? `$_${postfix}__` : ``}`
  }

  cache.set(id, url)
  return url
}

export function getAssetHash(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 8)
}

export async function urlToBuiltUrl(
  url: string,
  importer: string,
  config: ResolvedConfig,
  pluginContext: PluginContext
): Promise<string> {
  if (checkPublicFile(url, config)) {
    return config.base + url.slice(1)
  }
  const file = url.startsWith('/')
    ? path.join(config.root, url)
    : path.join(path.dirname(importer), url)

  const stat = await fsp.stat(cleanUrl(file))
  if (stat.isDirectory()) {
    return url
  }

  return fileToBuiltUrl(
    file,
    config,
    pluginContext,
    // skip public check since we just did it above
    true
  )
}
