// @ts-check
// this is automtically detected by scripts/jestPerTestSetup.ts and will replace
// the default e2e test serve behavior

const path = require('path')
const http = require('http')
const sirv = require('sirv')

const port = (exports.port = 9527)

/**
 * @param {string} root
 * @param {boolean} isProd
 */
exports.serve = async function serve(root, isProd) {
  let autoPreload = false
  if (isProd) {
    autoPreload = true
  }
  // build first
  const { build } = require('vite')
  await build({
    root,
    logLevel: 'silent',
    build: {
      terserOptions: {
        compress: {
          passes: 3
        }
      },
      autoPreload
    }
  })

  // start static file server
  const serve = sirv(path.resolve(root, 'dist'))
  const httpServer = http.createServer((req, res) => {
    if (req.url === '/ping') {
      res.statusCode = 200
      res.end('pong')
    } else {
      serve(req, res)
    }
  })

  return new Promise((resolve, reject) => {
    try {
      const server = httpServer.listen(port, () => {
        resolve({
          // for test teardown
          async close() {
            await new Promise((resolve) => {
              server.close(resolve)
            })
          }
        })
      })
    } catch (e) {
      reject(e)
    }
  })
}
