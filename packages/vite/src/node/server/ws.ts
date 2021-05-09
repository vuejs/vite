import chalk from 'chalk'
import { Server } from 'http'
import WebSocket from 'ws'
import { ErrorPayload, HMRPayload } from 'types/hmrPayload'
import { ResolvedConfig } from '..'

export const HMR_HEADER = 'vite-hmr'

export interface WebSocketServer {
  send(payload: HMRPayload): void
  close(): Promise<void>
}

export function createWebSocketServer(
  server: Server | null,
  config: ResolvedConfig
): WebSocketServer {
  let wss: WebSocket.Server

  const hmr = typeof config.server.hmr === 'object' && config.server.hmr
  const wsServer = (hmr && hmr.server) || server

  if (wsServer) {
    wss = new WebSocket.Server({ noServer: true })
    wsServer.on('upgrade', (req, socket, head) => {
      if (req.headers['sec-websocket-protocol'] === HMR_HEADER) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req)
        })
      }
    })
  } else {
    // vite dev server in middleware mode
    wss = new WebSocket.Server({
      port: (hmr && hmr.port) || 24678
    })
  }

  wss.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'connected' }))
    if (bufferedError) {
      socket.send(JSON.stringify(bufferedError))
      bufferedError = null
    }
  })

  wss.on('error', (e: Error & { code: string }) => {
    if (e.code !== 'EADDRINUSE') {
      config.logger.error(
        chalk.red(`WebSocket server error:\n${e.stack || e.message}`)
      )
    }
  })

  // On page reloads, if a file fails to compile and returns 500, the server
  // sends the error payload before the client connection is established.
  // If we have no open clients, buffer the error and send it to the next
  // connected client.
  let bufferedError: ErrorPayload | null = null

  return {
    send(payload: HMRPayload) {
      if (payload.type === 'error' && !wss.clients.size) {
        bufferedError = payload
        return
      }

      const stringified = JSON.stringify(payload)
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(stringified)
        }
      })
    },

    close() {
      return new Promise((resolve, reject) => {
        wss.close((err) => {
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        })
      })
    }
  }
}

export function createMockWebSocketServer(
  _server: Server | null,
  config: ResolvedConfig
) {
  return {
    send(payload: HMRPayload) {
      if (payload.type === 'error') {
        config.logger.info(
          chalk.red(`WebSocket server [mock] error:\n${payload.err.message}`)
        )
      } else {
        const formattedPayload = JSON.stringify(payload, undefined, 2)
        config.logger.info(
          chalk.dim(`WebSocket server [mock] payload:\n${formattedPayload}`)
        )
      }
    },

    close() {
      return Promise.resolve()
    }
  }
}
