const { getViteConfig } = require('./getViteConfig')
const hydrateFile = require.resolve('./hydrate')
const getPagesFile = require.resolve('./getPages')

module.exports.build = build

async function build(root, silent) {
  const { build: viteBuild } = require('vite')

  const configBase = getViteConfig(root)
  if (silent) {
    configBase.logLevel = 'error'
  }

  // client build
  await viteBuild({
    ...configBase,
    build: {
      outDir: 'dist/client',
      manifest: true,
      polyfillDynamicImport: false,
      rollupOptions: { input: hydrateFile }
    }
  })

  // server build
  await viteBuild({
    ...configBase,
    build: {
      outDir: 'dist/server',
      manifest: true,
      polyfillDynamicImport: false,
      rollupOptions: { input: getPagesFile },
      ssr: true
    }
  })
}
