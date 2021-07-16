import path from 'path'
import { ViteDevServer } from '..'
import { Connect } from 'types/connect'
import {
  cleanUrl,
  createDebugger,
  injectQuery,
  isImportRequest,
  isJSRequest,
  normalizePath,
  prettifyUrl,
  removeImportQuery,
  removeTimestampQuery,
  unwrapId
} from '../../utils'
import { send } from '../send'
import { transformRequest } from '../transformRequest'
import { isHTMLProxy } from '../../plugins/html'
import chalk from 'chalk'
import {
  CLIENT_PUBLIC_PATH,
  DEP_VERSION_RE,
  NULL_BYTE_PLACEHOLDER
} from '../../constants'
import { isCSSRequest, isDirectCSSRequest } from '../../plugins/css'

/**
 * Time (ms) Vite has to full-reload the page before returning
 * an empty response.
 */
const NEW_DEPENDENCY_BUILD_TIMEOUT = 1000

const debugCache = createDebugger('vite:cache')
const isDebug = !!process.env.DEBUG

const knownIgnoreList = new Set(['/', '/favicon.ico'])

export function transformMiddleware(
  server: ViteDevServer
): Connect.NextHandleFunction {
  const {
    config: { root, logger, cacheDir },
    moduleGraph
  } = server

  // determine the url prefix of files inside cache directory
  let cacheDirPrefix: string | undefined
  if (cacheDir) {
    const cacheDirRelative = normalizePath(path.relative(root, cacheDir))
    if (cacheDirRelative.startsWith('../')) {
      // if the cache directory is outside root, the url prefix would be something
      // like '/@fs/absolute/path/to/node_modules/.vite'
      cacheDirPrefix = `/@fs/${normalizePath(cacheDir).replace(/^\//, '')}`
    } else {
      // if the cache directory is inside root, the url prefix would be something
      // like '/node_modules/.vite'
      cacheDirPrefix = `/${cacheDirRelative}`
    }
  }

  // Keep the named function. The name is visible in debug logs via `DEBUG=connect:dispatcher ...`
  return async function viteTransformMiddleware(req, res, next) {
    if (req.method !== 'GET' || knownIgnoreList.has(req.url!)) {
      return next()
    }

    if (
      server._pendingReload &&
      // always allow vite client requests so that it can trigger page reload
      !req.url?.startsWith(CLIENT_PUBLIC_PATH) &&
      !req.url?.includes('vite/dist/client')
    ) {
      // missing dep pending reload, hold request until reload happens
      server._pendingReload.then(() =>
        // If the refresh has not happened after timeout, Vite considers
        // something unexpected has happened. In this case, Vite
        // returns an empty response that will error.
        setTimeout(() => {
          // status code request timeout
          res.statusCode = 408
          res.end(
            `<h1>[vite] Something unexpected happened while optimizing "${req.url}"<h1>` +
              `<p>The current page should have reloaded by now</p>`
          )
        }, NEW_DEPENDENCY_BUILD_TIMEOUT)
      )
      return
    }

    let url
    try {
      url = removeTimestampQuery(req.url!).replace(NULL_BYTE_PLACEHOLDER, '\0')
    } catch (err) {
      // if it starts with %PUBLIC%, someone's migrating from something
      // like create-react-app
      let errorMessage
      if (req.url?.startsWith('/%PUBLIC')) {
        errorMessage = `index.html shouldn't include environment variables like %PUBLIC_URL%, see https://vitejs.dev/guide/#index-html-and-project-root for more information`
      } else {
        errorMessage = `Vite encountered a suspiciously malformed request ${req.url}`
      }
      next(new Error(errorMessage))
      return
    }

    const withoutQuery = cleanUrl(url)

    try {
      const isSourceMap = withoutQuery.endsWith('.map')
      // since we generate source map references, handle those requests here
      if (isSourceMap) {
        const originalUrl = url.replace(/\.map($|\?)/, '$1')
        const map = (await moduleGraph.getModuleByUrl(originalUrl))
          ?.transformResult?.map
        if (map) {
          return send(req, res, JSON.stringify(map), 'json')
        } else {
          return next()
        }
      }

      // warn explicit /public/ paths
      if (url.startsWith('/public/') && !url.includes('.html')) {
        logger.warn(
          chalk.yellow(
            `files in the public directory are served at the root path.\n` +
              `Instead of ${chalk.cyan(url)}, use ${chalk.cyan(
                url.replace(/^\/public\//, '/')
              )}.`
          )
        )
      }

      if (
        isJSRequest(url) ||
        isImportRequest(url) ||
        isCSSRequest(url) ||
        isHTMLProxy(url)
      ) {
        // strip ?import
        url = removeImportQuery(url)
        // Strip valid id prefix. This is prepended to resolved Ids that are
        // not valid browser import specifiers by the importAnalysis plugin.
        url = unwrapId(url)

        // for CSS, we need to differentiate between normal CSS requests and
        // imports
        if (isCSSRequest(url) && req.headers.accept?.includes('text/css')) {
          url = injectQuery(url, 'direct')
        }

        // check if we can return 304 early
        const ifNoneMatch = req.headers['if-none-match']
        if (
          ifNoneMatch &&
          (await moduleGraph.getModuleByUrl(url))?.transformResult?.etag ===
            ifNoneMatch
        ) {
          isDebug && debugCache(`[304] ${prettifyUrl(url, root)}`)
          res.statusCode = 304
          return res.end()
        }

        // resolve, load and transform using the plugin container
        const result = await transformRequest(url, server, {
          html: req.headers.accept?.includes('text/html')
        })
        if (result) {
          const type = isDirectCSSRequest(url) ? 'css' : 'js'
          const isDep =
            DEP_VERSION_RE.test(url) ||
            (cacheDirPrefix && url.startsWith(cacheDirPrefix))
          return send(
            req,
            res,
            result.code,
            type,
            result.etag,
            // allow browser to cache npm deps!
            isDep ? 'max-age=31536000,immutable' : 'no-cache',
            result.map
          )
        }
      }
    } catch (e) {
      return next(e)
    }

    next()
  }
}
