// @ts-check
// this is automtically detected by scripts/jestPerTestSetup.ts and will replace
// the default e2e test serve behavior

const port = (exports.port = 9529)
const root = `${__dirname}/..`

exports.serve = async function serve(_, isProduction) {
  const { startServer, build } = require('vue-framework')
  if (isProduction) {
    process.env.NODE_ENV = 'production'
    await build(root, true)
  }
  return await startServer(root, port, isProduction)
}
