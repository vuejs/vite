import * as http from 'http'
import { createDebugger } from '../../utils'
import httpProxy from 'http-proxy'
import { HMR_HEADER } from '../ws'
import { Connect } from 'types/connect'
import { HttpProxy } from 'types/http-proxy'
import chalk from 'chalk'
import { ResolvedConfig } from '../..'

const debug = createDebugger('vite:proxy')

export interface ProxyOptions extends HttpProxy.ServerOptions {
  /**
   * rewrite path
   */
  rewrite?: (path: string) => string
  /**
   * re-target option.target for specific requests
   */
  router?:
    | { [hostOrPath: string]: HttpProxy.ServerOptions['target'] }
    | ((req: http.IncomingMessage) => HttpProxy.ServerOptions['target'])
    | ((
        req: http.IncomingMessage
      ) => Promise<HttpProxy.ServerOptions['target']>)
  /**
   * configure the proxy server (e.g. listen to events)
   */
  configure?: (proxy: HttpProxy.Server, options: ProxyOptions) => void
  /**
   * webpack-dev-server style bypass function
   */
  bypass?: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    options: ProxyOptions
  ) => void | null | undefined | false | string
}

export function proxyMiddleware(
  httpServer: http.Server | null,
  config: ResolvedConfig
): Connect.NextHandleFunction {
  const options = config.server.proxy!

  // lazy require only when proxy is used
  const proxies: Record<string, [HttpProxy.Server, ProxyOptions]> = {}

  Object.keys(options).forEach((context) => {
    let opts = options[context]
    if (typeof opts === 'string') {
      opts = { target: opts, changeOrigin: true } as ProxyOptions
    }
    const proxy = httpProxy.createProxyServer(opts) as HttpProxy.Server

    proxy.on('error', (err) => {
      config.logger.error(`${chalk.red(`http proxy error:`)}\n${err.stack}`, {
        timestamp: true
      })
    })

    if (opts.configure) {
      opts.configure(proxy, opts)
    }
    // clone before saving because http-proxy mutates the options
    proxies[context] = [proxy, { ...opts }]
  })

  if (httpServer) {
    httpServer.on('upgrade', (req, socket, head) => {
      const url = req.url!
      for (const context in proxies) {
        if (url.startsWith(context)) {
          const [proxy, opts] = proxies[context]
          if (
            (opts.ws || opts.target?.toString().startsWith('ws:')) &&
            req.headers['sec-websocket-protocol'] !== HMR_HEADER
          ) {
            if (opts.rewrite) {
              req.url = opts.rewrite(url)
            }
            proxy.ws(req, socket, head)
          }
        }
      }
    })
  }

  // Keep the named function. The name is visible in debug logs via `DEBUG=connect:dispatcher ...`
  return async function viteProxyMiddleware(req, res, next) {
    const url = req.url!
    for (const context in proxies) {
      if (
        (context.startsWith('^') && new RegExp(context).test(url)) ||
        url.startsWith(context)
      ) {
        const [proxy, opts] = proxies[context]

        if (opts.bypass) {
          const bypassResult = opts.bypass(req, res, opts)
          if (typeof bypassResult === 'string') {
            req.url = bypassResult
            debug(`bypass: ${req.url} -> ${bypassResult}`)
            return next()
          } else if (bypassResult === false) {
            debug(`bypass: ${req.url} -> 404`)
            return res.end(404)
          }
        }

        const activeProxyOptions = await prepareProxyRequest(req, opts)
        debug(`${req.url} -> ${opts.target || opts.forward}`)
        proxy.web(req, res, activeProxyOptions)
        return
      }
    }
    next()
  }
}

async function prepareProxyRequest(
  req: http.IncomingMessage,
  opts: ProxyOptions
) {
  // req.url = req.originalUrl || req.url
  const newProxyOptions = Object.assign({}, opts)

  if (opts.router) {
    const newTarget = await getTarget(req, opts)
    if (newTarget) {
      debug('[proxy] Router new target: %s -> "%s"', opts.target, newTarget)
      newProxyOptions.target = newTarget
    }
  }
  if (opts.rewrite) {
    req.url = opts.rewrite(req.url!)
  }

  return newProxyOptions
}

async function getTarget(req: http.IncomingMessage, config: ProxyOptions) {
  let newTarget
  const router = config.router

  switch (typeof router) {
    case 'function':
      newTarget = await router(req)
      break
    case 'object':
      newTarget = getTargetFromProxyTable(req, router)
      break
  }

  return newTarget
}

function getTargetFromProxyTable(
  req: http.IncomingMessage,
  table: { [hostOrPath: string]: HttpProxy.ServerOptions['target'] }
) {
  let result
  const host = req.headers.host as string
  const path = req.url

  const hostAndPath = host + path

  for (const [key, value] of Object.entries(table)) {
    if (key.indexOf('/') > -1) {
      if (hostAndPath.indexOf(key) > -1) {
        // match 'localhost:3000/api'
        result = value
        debug('[proxy] Router table match: "%s"', key)
        continue
      }
    } else {
      if (key === host) {
        // match 'localhost:3000'
        result = value
        debug('[proxy] Router table match: "%s"', host)
        continue
      }
    }
  }

  return result
}
