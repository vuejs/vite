import fs from 'fs'
import path from 'path'
import * as net from 'net'
import * as http from 'http'
import * as https from 'https'
import connect from 'connect'
import corsMiddleware from 'cors'
import chalk from 'chalk'
import { AddressInfo } from 'net'
import chokidar from 'chokidar'
import { resolveHttpsConfig, resolveHttpServer } from './http'
import { resolveConfig, InlineConfig, ResolvedConfig } from '../config'
import {
  createPluginContainer,
  PluginContainer
} from '../server/pluginContainer'
import { FSWatcher, WatchOptions } from 'types/chokidar'
import { createWebSocketServer, WebSocketServer } from '../server/ws'
import { baseMiddleware } from './middlewares/base'
import { proxyMiddleware, ProxyOptions } from './middlewares/proxy'
import { transformMiddleware } from './middlewares/transform'
import {
  createDevHtmlTransformFn,
  indexHtmlMiddleware
} from './middlewares/indexHtml'
import history from 'connect-history-api-fallback'
import { decodeURIMiddleware } from './middlewares/decodeURI'
import {
  serveRawFsMiddleware,
  servePublicMiddleware,
  serveStaticMiddleware
} from './middlewares/static'
import { timeMiddleware } from './middlewares/time'
import { ModuleGraph, ModuleNode } from './moduleGraph'
import { Connect } from 'types/connect'
import { createDebugger, ensureLeadingSlash, normalizePath } from '../utils'
import { errorMiddleware, prepareError } from './middlewares/error'
import { handleHMRUpdate, HmrOptions, handleFileAddUnlink } from './hmr'
import { openBrowser } from './openBrowser'
import launchEditorMiddleware from 'launch-editor-middleware'
import { TransformResult } from 'rollup'
import { TransformOptions, transformRequest } from './transformRequest'
import {
  transformWithEsbuild,
  ESBuildTransformResult
} from '../plugins/esbuild'
import { TransformOptions as EsbuildTransformOptions } from 'esbuild'
import { DepOptimizationMetadata, optimizeDeps } from '../optimizer'
import { ssrLoadModule } from '../ssr/ssrModuleLoader'
import { resolveSSRExternal } from '../ssr/ssrExternal'
import {
  rebindErrorStacktrace,
  ssrRewriteStacktrace
} from '../ssr/ssrStacktrace'
import { createMissingImporterRegisterFn } from '../optimizer/registerMissing'
import { printServerUrls } from '../logger'
import { resolveHostname } from '../utils'
import { searchForWorkspaceRoot } from './searchRoot'
import { CLIENT_DIR } from '../constants'

export interface ServerOptions {
  host?: string | boolean
  port?: number
  /**
   * Enable TLS + HTTP/2.
   * Note: this downgrades to TLS only when the proxy option is also used.
   */
  https?: boolean | https.ServerOptions
  /**
   * Open browser window on startup
   */
  open?: boolean | string
  /**
   * Force dep pre-optimization regardless of whether deps have changed.
   */
  force?: boolean
  /**
   * Configure HMR-specific options (port, host, path & protocol)
   */
  hmr?: HmrOptions | boolean
  /**
   * chokidar watch options
   * https://github.com/paulmillr/chokidar#api
   */
  watch?: WatchOptions
  /**
   * Configure custom proxy rules for the dev server. Expects an object
   * of `{ key: options }` pairs.
   * Uses [`http-proxy`](https://github.com/http-party/node-http-proxy).
   * Full options [here](https://github.com/http-party/node-http-proxy#options).
   *
   * Example `vite.config.js`:
   * ``` js
   * module.exports = {
   *   proxy: {
   *     // string shorthand
   *     '/foo': 'http://localhost:4567/foo',
   *     // with options
   *     '/api': {
   *       target: 'http://jsonplaceholder.typicode.com',
   *       changeOrigin: true,
   *       rewrite: path => path.replace(/^\/api/, '')
   *     }
   *   }
   * }
   * ```
   */
  proxy?: Record<string, string | ProxyOptions>
  /**
   * Configure CORS for the dev server.
   * Uses https://github.com/expressjs/cors.
   * Set to `true` to allow all methods from any origin, or configure separately
   * using an object.
   */
  cors?: CorsOptions | boolean
  /**
   * If enabled, vite will exit if specified port is already in use
   */
  strictPort?: boolean
  /**
   * Create Vite dev server to be used as a middleware in an existing server
   */
  middlewareMode?: boolean | 'html' | 'ssr'
  /**
   * Prepend this folder to http requests, for use when proxying vite as a subfolder
   * Should start and end with the `/` character
   */
  base?: string
  /**
   * Options for files served via '/\@fs/'.
   */
  fs?: FileSystemServeOptions
}

export interface ResolvedServerOptions extends ServerOptions {
  fs: Required<FileSystemServeOptions>
}

export interface FileSystemServeOptions {
  /**
   * Strictly restrict file accessing outside of allowing paths.
   *
   * Set to `false` to disable the warning
   * Default to false at this moment, will enabled by default in the future versions.
   *
   * @expiremental
   * @default undefined
   */
  strict?: boolean | undefined

  /**
   * Restrict accessing files outside the allowed directories.
   *
   * Accepts absolute path or a path relative to project root.
   * Will try to search up for workspace root by default.
   *
   * @expiremental
   */
  allow?: string[]
}

/**
 * https://github.com/expressjs/cors#configuration-options
 */
export interface CorsOptions {
  origin?:
    | CorsOrigin
    | ((origin: string, cb: (err: Error, origins: CorsOrigin) => void) => void)
  methods?: string | string[]
  allowedHeaders?: string | string[]
  exposedHeaders?: string | string[]
  credentials?: boolean
  maxAge?: number
  preflightContinue?: boolean
  optionsSuccessStatus?: number
}

export type CorsOrigin = boolean | string | RegExp | (string | RegExp)[]

export type ServerHook = (
  server: ViteDevServer
) => (() => void) | void | Promise<(() => void) | void>

export interface ViteDevServer {
  /**
   * The resolved vite config object
   */
  config: ResolvedConfig
  /**
   * A connect app instance.
   * - Can be used to attach custom middlewares to the dev server.
   * - Can also be used as the handler function of a custom http server
   *   or as a middleware in any connect-style Node.js frameworks
   *
   * https://github.com/senchalabs/connect#use-middleware
   */
  middlewares: Connect.Server
  /**
   * @deprecated use `server.middlewares` instead
   */
  app: Connect.Server
  /**
   * native Node http server instance
   * will be null in middleware mode
   */
  httpServer: http.Server | null
  /**
   * chokidar watcher instance
   * https://github.com/paulmillr/chokidar#api
   */
  watcher: FSWatcher
  /**
   * web socket server with `send(payload)` method
   */
  ws: WebSocketServer
  /**
   * Rollup plugin container that can run plugin hooks on a given file
   */
  pluginContainer: PluginContainer
  /**
   * Module graph that tracks the import relationships, url to file mapping
   * and hmr state.
   */
  moduleGraph: ModuleGraph
  /**
   * Programmatically resolve, load and transform a URL and get the result
   * without going through the http request pipeline.
   */
  transformRequest(
    url: string,
    options?: TransformOptions
  ): Promise<TransformResult | null>
  /**
   * Apply vite built-in HTML transforms and any plugin HTML transforms.
   */
  transformIndexHtml(
    url: string,
    html: string,
    originalUrl?: string
  ): Promise<string>
  /**
   * Util for transforming a file with esbuild.
   * Can be useful for certain plugins.
   */
  transformWithEsbuild(
    code: string,
    filename: string,
    options?: EsbuildTransformOptions,
    inMap?: object
  ): Promise<ESBuildTransformResult>
  /**
   * Load a given URL as an instantiated module for SSR.
   */
  ssrLoadModule(url: string): Promise<Record<string, any>>
  /**
   * Fix ssr error stacktrace
   */
  ssrFixStacktrace(e: Error): void
  /**
   * Start the server.
   */
  listen(port?: number, isRestart?: boolean): Promise<ViteDevServer>
  /**
   * Stop the server.
   */
  close(): Promise<void>
  /**
   * @internal
   */
  _optimizeDepsMetadata: DepOptimizationMetadata | null
  /**
   * Deps that are externalized
   * @internal
   */
  _ssrExternals: string[] | null
  /**
   * @internal
   */
  _globImporters: Record<
    string,
    {
      module: ModuleNode
      importGlobs: {
        base: string
        pattern: string
      }[]
    }
  >
  /**
   * @internal
   */
  _isRunningOptimizer: boolean
  /**
   * @internal
   */
  _registerMissingImport:
    | ((id: string, resolved: string, ssr: boolean | undefined) => void)
    | null
  /**
   * @internal
   */
  _pendingReload: Promise<void> | null
}

export async function createServer(
  inlineConfig: InlineConfig = {}
): Promise<ViteDevServer> {
  const config = await resolveConfig(inlineConfig, 'serve', 'development')
  const root = config.root
  const serverConfig = config.server
  const httpsOptions = await resolveHttpsConfig(config)
  let { middlewareMode } = serverConfig
  if (middlewareMode === true) {
    middlewareMode = 'ssr'
  }

  const middlewares = connect() as Connect.Server
  const httpServer = middlewareMode
    ? null
    : await resolveHttpServer(serverConfig, middlewares, httpsOptions)
  const ws = createWebSocketServer(httpServer, config, httpsOptions)

  const { ignored = [], ...watchOptions } = serverConfig.watch || {}
  const watcher = chokidar.watch(path.resolve(root), {
    ignored: ['**/node_modules/**', '**/.git/**', ...ignored],
    ignoreInitial: true,
    ignorePermissionErrors: true,
    disableGlobbing: true,
    ...watchOptions
  }) as FSWatcher

  const plugins = config.plugins
  const container = await createPluginContainer(config, watcher)
  const moduleGraph = new ModuleGraph(container)
  const closeHttpServer = createServerCloseFn(httpServer)

  // eslint-disable-next-line prefer-const
  let exitProcess: () => void

  const server: ViteDevServer = {
    config: config,
    middlewares,
    get app() {
      config.logger.warn(
        `ViteDevServer.app is deprecated. Use ViteDevServer.middlewares instead.`
      )
      return middlewares
    },
    httpServer,
    watcher,
    pluginContainer: container,
    ws,
    moduleGraph,
    transformWithEsbuild,
    transformRequest(url, options) {
      return transformRequest(url, server, options)
    },
    transformIndexHtml: null as any,
    ssrLoadModule(url) {
      if (!server._ssrExternals) {
        server._ssrExternals = resolveSSRExternal(
          config,
          server._optimizeDepsMetadata
            ? Object.keys(server._optimizeDepsMetadata.optimized)
            : []
        )
      }
      return ssrLoadModule(url, server)
    },
    ssrFixStacktrace(e) {
      if (e.stack) {
        const stacktrace = ssrRewriteStacktrace(e.stack, moduleGraph)
        rebindErrorStacktrace(e, stacktrace)
      }
    },
    listen(port?: number, isRestart?: boolean) {
      return startServer(server, port, isRestart)
    },
    async close() {
      process.off('SIGTERM', exitProcess)

      if (!middlewareMode && process.env.CI !== 'true') {
        process.stdin.off('end', exitProcess)
      }

      await Promise.all([
        watcher.close(),
        ws.close(),
        container.close(),
        closeHttpServer()
      ])
    },
    _optimizeDepsMetadata: null,
    _ssrExternals: null,
    _globImporters: {},
    _isRunningOptimizer: false,
    _registerMissingImport: null,
    _pendingReload: null
  }

  server.transformIndexHtml = createDevHtmlTransformFn(server)

  exitProcess = async () => {
    try {
      await server.close()
    } finally {
      process.exit(0)
    }
  }

  process.once('SIGTERM', exitProcess)

  if (!middlewareMode && process.env.CI !== 'true') {
    process.stdin.on('end', exitProcess)
  }

  watcher.on('change', async (file) => {
    file = normalizePath(file)
    // invalidate module graph cache on file change
    moduleGraph.onFileChange(file)
    if (serverConfig.hmr !== false) {
      try {
        await handleHMRUpdate(file, server)
      } catch (err) {
        ws.send({
          type: 'error',
          err: prepareError(err)
        })
      }
    }
  })

  watcher.on('add', (file) => {
    handleFileAddUnlink(normalizePath(file), server)
  })

  watcher.on('unlink', (file) => {
    handleFileAddUnlink(normalizePath(file), server, true)
  })

  if (!middlewareMode && httpServer) {
    httpServer.once('listening', () => {
      // update actual port since this may be different from initial value
      serverConfig.port = (httpServer.address() as AddressInfo).port
    })
  }

  // apply server configuration hooks from plugins
  const postHooks: ((() => void) | void)[] = []
  for (const plugin of plugins) {
    if (plugin.configureServer) {
      postHooks.push(await plugin.configureServer(server))
    }
  }

  // Internal middlewares ------------------------------------------------------

  // request timer
  if (process.env.DEBUG) {
    middlewares.use(timeMiddleware(root))
  }

  // cors (enabled by default)
  const { cors } = serverConfig
  if (cors !== false) {
    middlewares.use(corsMiddleware(typeof cors === 'boolean' ? {} : cors))
  }

  // proxy
  const { proxy } = serverConfig
  if (proxy) {
    middlewares.use(proxyMiddleware(httpServer, config))
  }

  // base
  if (config.base !== '/') {
    middlewares.use(baseMiddleware(server))
  }

  // open in editor support
  middlewares.use('/__open-in-editor', launchEditorMiddleware())

  // hmr reconnect ping
  // Keep the named function. The name is visible in debug logs via `DEBUG=connect:dispatcher ...`
  middlewares.use('/__vite_ping', function viteHMRPingMiddleware(_, res) {
    res.end('pong')
  })

  //decode request url
  middlewares.use(decodeURIMiddleware())

  // serve static files under /public
  // this applies before the transform middleware so that these files are served
  // as-is without transforms.
  if (config.publicDir) {
    middlewares.use(servePublicMiddleware(config.publicDir))
  }

  // main transform middleware
  middlewares.use(transformMiddleware(server))

  // serve static files
  middlewares.use(serveRawFsMiddleware(server))
  middlewares.use(serveStaticMiddleware(root, config))

  // spa fallback
  if (!middlewareMode || middlewareMode === 'html') {
    middlewares.use(
      history({
        logger: createDebugger('vite:spa-fallback'),
        // support /dir/ without explicit index.html
        rewrites: [
          {
            from: /\/$/,
            to({ parsedUrl }: any) {
              const rewritten = parsedUrl.pathname + 'index.html'
              if (fs.existsSync(path.join(root, rewritten))) {
                return rewritten
              } else {
                return `/index.html`
              }
            }
          }
        ]
      })
    )
  }

  // run post config hooks
  // This is applied before the html middleware so that user middleware can
  // serve custom content instead of index.html.
  postHooks.forEach((fn) => fn && fn())

  if (!middlewareMode || middlewareMode === 'html') {
    // transform index.html
    middlewares.use(indexHtmlMiddleware(server))
    // handle 404s
    // Keep the named function. The name is visible in debug logs via `DEBUG=connect:dispatcher ...`
    middlewares.use(function vite404Middleware(_, res) {
      res.statusCode = 404
      res.end()
    })
  }

  // error handler
  middlewares.use(errorMiddleware(server, !!middlewareMode))

  const runOptimize = async () => {
    if (config.cacheDir) {
      server._isRunningOptimizer = true
      try {
        server._optimizeDepsMetadata = await optimizeDeps(config)
      } finally {
        server._isRunningOptimizer = false
      }
      server._registerMissingImport = createMissingImporterRegisterFn(server)
    }
  }

  if (!middlewareMode && httpServer) {
    // overwrite listen to run optimizer before server start
    const listen = httpServer.listen.bind(httpServer)
    httpServer.listen = (async (port: number, ...args: any[]) => {
      try {
        await container.buildStart({})
        await runOptimize()
      } catch (e) {
        httpServer.emit('error', e)
        return
      }
      return listen(port, ...args)
    }) as any
  } else {
    await container.buildStart({})
    await runOptimize()
  }

  return server
}

async function startServer(
  server: ViteDevServer,
  inlinePort?: number,
  isRestart: boolean = false
): Promise<ViteDevServer> {
  const httpServer = server.httpServer
  if (!httpServer) {
    throw new Error('Cannot call server.listen in middleware mode.')
  }

  const options = server.config.server
  let port = inlinePort || options.port || 3000
  const hostname = resolveHostname(options.host)

  const protocol = options.https ? 'https' : 'http'
  const info = server.config.logger.info
  const base = server.config.base

  return new Promise((resolve, reject) => {
    const onError = (e: Error & { code?: string }) => {
      if (e.code === 'EADDRINUSE') {
        if (options.strictPort) {
          httpServer.removeListener('error', onError)
          reject(new Error(`Port ${port} is already in use`))
        } else {
          info(`Port ${port} is in use, trying another one...`)
          httpServer.listen(++port, hostname.host)
        }
      } else {
        httpServer.removeListener('error', onError)
        reject(e)
      }
    }

    httpServer.on('error', onError)

    httpServer.listen(port, hostname.host, () => {
      httpServer.removeListener('error', onError)

      info(
        chalk.cyan(`\n  vite v${require('vite/package.json').version}`) +
          chalk.green(` dev server running at:\n`),
        {
          clear: !server.config.logger.hasWarned
        }
      )

      printServerUrls(hostname, protocol, port, base, info)

      // @ts-ignore
      if (global.__vite_start_time) {
        info(
          chalk.cyan(
            // @ts-ignore
            `\n  ready in ${Date.now() - global.__vite_start_time}ms.\n`
          )
        )
      }

      // @ts-ignore
      const profileSession = global.__vite_profile_session
      if (profileSession) {
        profileSession.post('Profiler.stop', (err: any, { profile }: any) => {
          // Write profile to disk, upload, etc.
          if (!err) {
            const outPath = path.resolve('./vite-profile.cpuprofile')
            fs.writeFileSync(outPath, JSON.stringify(profile))
            info(
              chalk.yellow(
                `  CPU profile written to ${chalk.white.dim(outPath)}\n`
              )
            )
          } else {
            throw err
          }
        })
      }

      if (options.open && !isRestart) {
        const path = typeof options.open === 'string' ? options.open : base
        openBrowser(
          `${protocol}://${hostname.name}:${port}${path}`,
          true,
          server.config.logger
        )
      }

      resolve(server)
    })
  })
}

function createServerCloseFn(server: http.Server | null) {
  if (!server) {
    return () => {}
  }

  let hasListened = false
  const openSockets = new Set<net.Socket>()

  server.on('connection', (socket) => {
    openSockets.add(socket)
    socket.on('close', () => {
      openSockets.delete(socket)
    })
  })

  server.once('listening', () => {
    hasListened = true
  })

  return () =>
    new Promise<void>((resolve, reject) => {
      openSockets.forEach((s) => s.destroy())
      if (hasListened) {
        server.close((err) => {
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        })
      } else {
        resolve()
      }
    })
}

function resolvedAllowDir(root: string, dir: string): string {
  return ensureLeadingSlash(normalizePath(path.resolve(root, dir)))
}

export function resolveServerOptions(
  root: string,
  raw?: ServerOptions
): ResolvedServerOptions {
  const server = raw || {}
  let allowDirs = server.fs?.allow

  if (!allowDirs) {
    allowDirs = [searchForWorkspaceRoot(root)]
  }

  allowDirs = allowDirs.map((i) => resolvedAllowDir(root, i))

  // only push client dir when vite itself is outside-of-root
  const resolvedClientDir = resolvedAllowDir(root, CLIENT_DIR)
  if (!allowDirs.some((i) => resolvedClientDir.startsWith(i))) {
    allowDirs.push(resolvedClientDir)
  }

  server.fs = {
    // TODO: make strict by default
    strict: server.fs?.strict,
    allow: allowDirs
  }
  return server as ResolvedServerOptions
}
