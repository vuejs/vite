const { renderToString } = require('@vue/server-renderer')
const { relative } = require('path')
const { createSSRApp } = require('vue')
const hydrateFile = require.resolve('./hydrate')
const getPagesFile = require.resolve('./getPages')

module.exports.createPageRender = createPageRender

const env = {}

function createPageRender(viteServer, root, isProduction) {
  Object.assign(env, { viteServer, root, isProduction })
  return render
}

async function render(url) {
  const routeMatch = await route(url)
  if (routeMatch === null) return null
  const { Page, pagePath } = routeMatch
  const app = createSSRApp(Page)
  const html = await renderToString(app)
  return `<!DOCTYPE html>
    <html>
      <head>
        <script>window.pagePath = '${pagePath}'</script>
        <script async type="module" src="${getBrowserEntry()}"></script>
        <link rel="icon" href="data:;base64,=">
      </head>
      <body>
        <div id="app">${html}</div>
      </body>
    </html>
  `
}

function getBrowserEntry() {
  if (!env.isProduction) {
    return hydrateFile
  } else {
    return findBuildEntry(hydrateFile)
  }
}

function findBuildEntry(filePathAbsolute) {
  const clientManifestPath = `${env.root}/dist/client/manifest.json`
  const clientManifest = require(clientManifestPath)
  const filePathRelative = relative(env.root, filePathAbsolute)
  const { file } = clientManifest[filePathRelative]
  return '/' + file
}

async function route(url) {
  const pages = await getPages()
  const fileName =
    url === '/' ? 'Home' : url.split('')[1].toUpperCase() + url.slice(2)
  const pageFiles = Object.keys(pages)
  const pagePath = pageFiles.find((pageFile) =>
    pageFile.endsWith(`${fileName}.vue`)
  )
  if (!pagePath) return null
  const pageLoader = pages[pagePath]
  const exports = await pageLoader()
  const Page = exports.default
  return { Page, pagePath }
}

async function getPages() {
  let exports
  if (!env.isProduction) {
    exports = await env.viteServer.ssrLoadModule(getPagesFile)
  } else {
    exports = require(`${env.root}/dist/server/getPages.js`)
  }
  return await exports.getPages()
}
