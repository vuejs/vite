import fs, { promises as fsp } from 'fs'
import path from 'path'
import { Server as HttpServer } from 'http'
import { ServerOptions as HttpsServerOptions } from 'https'
import { ResolvedConfig, ServerOptions } from '..'
import { Connect } from 'types/connect'
import { Logger } from '../logger'

export async function resolveHttpServer(
  { proxy }: ServerOptions,
  app: Connect.Server,
  httpsOptions?: HttpsServerOptions
): Promise<HttpServer> {
  if (!httpsOptions) {
    return require('http').createServer(app)
  }

  if (proxy) {
    // #484 fallback to http1 when proxy is needed.
    return require('https').createServer(httpsOptions, app)
  } else {
    return require('http2').createSecureServer(
      {
        ...httpsOptions,
        allowHTTP1: true
      },
      app
    )
  }
}

export async function resolveHttpsConfig(
  config: ResolvedConfig
): Promise<HttpsServerOptions | undefined> {
  if (!config.server.https) return undefined

  const httpsOption =
    typeof config.server.https === 'object' ? config.server.https : {}

  const { ca, cert, key, pfx } = httpsOption
  Object.assign(httpsOption, {
    ca: readFileIfExists(ca),
    cert: readFileIfExists(cert),
    key: readFileIfExists(key),
    pfx: readFileIfExists(pfx)
  })
  if (!httpsOption.key || !httpsOption.cert) {
    httpsOption.cert = httpsOption.key = await getCertificate(config)
  }
  return httpsOption
}

function readFileIfExists(value?: string | Buffer | any[]) {
  if (typeof value === 'string') {
    try {
      return fs.readFileSync(path.resolve(value as string))
    } catch (e) {
      return value
    }
  }
  return value
}

/**
 * https://github.com/webpack/webpack-dev-server/blob/master/lib/utils/createCertificate.js
 *
 * Copyright JS Foundation and other contributors
 * This source code is licensed under the MIT license found in the
 * LICENSE file at
 * https://github.com/webpack/webpack-dev-server/blob/master/LICENSE
 */
async function createCertificate() {
  const { generate } = await import('selfsigned')
  const pems = generate(null, {
    algorithm: 'sha256',
    days: 30,
    keySize: 2048,
    extensions: [
      // {
      //   name: 'basicConstraints',
      //   cA: true,
      // },
      {
        name: 'keyUsage',
        keyCertSign: true,
        digitalSignature: true,
        nonRepudiation: true,
        keyEncipherment: true,
        dataEncipherment: true
      },
      {
        name: 'extKeyUsage',
        serverAuth: true,
        clientAuth: true,
        codeSigning: true,
        timeStamping: true
      },
      {
        name: 'subjectAltName',
        altNames: [
          {
            // type 2 is DNS
            type: 2,
            value: 'localhost'
          },
          {
            type: 2,
            value: 'localhost.localdomain'
          },
          {
            type: 2,
            value: 'lvh.me'
          },
          {
            type: 2,
            value: '*.lvh.me'
          },
          {
            type: 2,
            value: '[::1]'
          },
          {
            // type 7 is IP
            type: 7,
            ip: '127.0.0.1'
          },
          {
            type: 7,
            ip: 'fe80::1'
          }
        ]
      }
    ]
  })
  return pems.private + pems.cert
}

async function getCertificate(config: ResolvedConfig) {
  if (!config.cacheDir) return await createCertificate()

  const cachePath = path.join(config.cacheDir, '_cert.pem')

  try {
    const [stat, content] = await Promise.all([
      fsp.stat(cachePath),
      fsp.readFile(cachePath, 'utf8')
    ])

    if (Date.now() - stat.ctime.valueOf() > 30 * 24 * 60 * 60 * 1000) {
      throw new Error('cache is outdated.')
    }

    return content
  } catch {
    const content = await createCertificate()
    fsp
      .mkdir(config.cacheDir, { recursive: true })
      .then(() => fsp.writeFile(cachePath, content))
      .catch(() => {})
    return content
  }
}

export async function httpServerStart(
  httpServer: HttpServer,
  serverOptions: {
    port: number
    strictPort: boolean | undefined
    host: string | undefined
    logger: Logger
  }
): Promise<number> {
  return new Promise((resolve, reject) => {
    let { port, strictPort, host, logger } = serverOptions

    const onError = (e: Error & { code?: string }) => {
      if (e.code === 'EADDRINUSE') {
        if (strictPort) {
          httpServer.removeListener('error', onError)
          reject(new Error(`Port ${port} is already in use`))
        } else {
          logger.info(`Port ${port} is in use, trying another one...`)
          httpServer.listen(++port, host)
        }
      } else {
        httpServer.removeListener('error', onError)
        reject(e)
      }
    }

    httpServer.on('error', onError)

    httpServer.listen(port, host, () => {
      httpServer.removeListener('error', onError)
      resolve(port)
    })
  })
}
