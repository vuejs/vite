// @ts-check
// this is automtically detected by scripts/jestPerTestSetup.ts and will replace
// the default e2e test serve behavior

const path = require('path')

const port = (exports.port = 9527)

/**
 * @param {string} root
 * @param {boolean} isProd
 */
exports.serve = async function serve(root, isProd) {
  const { createServer } = require('vite')
  const { createHostServer } = require(path.resolve(root, 'server.js'))
  const InlineConfig = require(path.resolve(root, 'vite.config.js'))

  const hostApp = await createHostServer(root, isProd)

  const hostHandler = new Promise((resolve, reject) => {
    try {
      const hostServer = hostApp.listen(8080, () => {
        resolve({
          close() {
            hostServer.close()
            return devServer && devServer.close()
          }
        })
      })
    } catch (e) {
      reject(e)
    }
  })

  const devServer = await createServer({
    root,
    base: InlineConfig.base,
    mode: InlineConfig.mode,
    configFile: InlineConfig.config,
    logLevel: InlineConfig.logLevel,
    clearScreen: InlineConfig.clearScreen,
    server: InlineConfig.server
  })
  await devServer.listen()

  return hostHandler
}
