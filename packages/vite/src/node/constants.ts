import path from 'path'

export const DEFAULT_MAIN_FIELDS = [
  'module',
  'jsnext:main', // moment still uses this...
  'jsnext'
]

export const DEFAULT_EXTENSIONS = [
  '.mjs',
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.json'
]

// warning, these are only default values. At runtime you must check config.knownJsSrcExtensions
export const DEFAULT_KNOWN_JS_SRC_EXTENSIONS = [
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.mjs',
  // the extensions below should be removed once their respective plugins add them via config hook
  '.vue',
  '.marko',
  '.svelte'
]

export const JS_TYPES_RE = /\.(?:j|t)sx?$|\.mjs$/

export const OPTIMIZABLE_ENTRY_RE = /\.(?:m?js|ts)$/

export const SPECIAL_QUERY_RE = /[\?&](?:worker|sharedworker|raw|url)\b/

/**
 * Prefix for resolved fs paths, since windows paths may not be valid as URLs.
 */
export const FS_PREFIX = `/@fs/`

/**
 * Prefix for resolved Ids that are not valid browser import specifiers
 */
export const VALID_ID_PREFIX = `/@id/`

/**
 * Some Rollup plugins use ids that starts with the null byte \0 to avoid
 * collisions, but it is not permitted in import URLs so we have to replace
 * them.
 */
export const NULL_BYTE_PLACEHOLDER = `__x00__`

export const CLIENT_PUBLIC_PATH = `/@vite/client`
export const ENV_PUBLIC_PATH = `/@vite/env`
// eslint-disable-next-line node/no-missing-require
export const CLIENT_ENTRY = require.resolve('vite/dist/client/client.mjs')
// eslint-disable-next-line node/no-missing-require
export const ENV_ENTRY = require.resolve('vite/dist/client/env.mjs')
export const CLIENT_DIR = path.dirname(CLIENT_ENTRY)

export const KNOWN_ASSET_TYPES = [
  // images
  'png',
  'jpe?g',
  'gif',
  'svg',
  'ico',
  'webp',
  'avif',

  // media
  'mp4',
  'webm',
  'ogg',
  'mp3',
  'wav',
  'flac',
  'aac',

  // fonts
  'woff2?',
  'eot',
  'ttf',
  'otf',

  // other
  'wasm'
]

export const DEFAULT_ASSETS_RE = new RegExp(
  `\\.(` + KNOWN_ASSET_TYPES.join('|') + `)(\\?.*)?$`
)

export const DEP_VERSION_RE = /[\?&](v=[\w\.-]+)\b/
