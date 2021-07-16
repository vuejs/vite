const express = require('express')
const { createPageRender } = require('./createPageRender.js')
const { getViteConfig } = require('./getViteConfig.js')
const vite = require('vite')

module.exports.startServer = startServer

async function startServer(root, port, isProduction) {
  const app = express()

  let viteServer
  if (isProduction) {
    app.use(express.static(`${root}/dist/client`, { index: false }))
  } else {
    viteServer = await vite.createServer({
      ...getViteConfig(root),
      logLevel: 'warn',
      optimizeDeps: { entries: ['**/pages/*.vue'] },
      server: {
        middlewareMode: true,
        watch: {
          // During tests we edit the files too fast and sometimes chokidar
          // misses change events, so enforce polling for consistency
          usePolling: true,
          interval: 100
        }
      }
    })
    app.use(viteServer.middlewares)
  }

  const renderPage = createPageRender(viteServer, root, isProduction)
  app.get('*', async (req, res, next) => {
    const url = req.originalUrl
    const html = await renderPage(url)
    if (html === null) return next()
    res.send(html)
  })

  return new Promise((resolve, reject) => {
    try {
      const server = app.listen(port, () => {
        resolve({
          // for test teardown
          async close() {
            await new Promise((resolve) => {
              server.close(resolve)
            })
            if (viteServer) {
              await viteServer.close()
            }
          }
        })
      })
    } catch (err) {
      reject(err)
    }
  })
}
