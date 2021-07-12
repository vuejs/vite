const { resolve } = require('path')

/**
 * @type {import('vite').UserConfig}
 */
module.exports = {
  base: '/foo/',
  build: {
    // simulate production environment
    outDir: 'dist/foo',
    // prevent bundling of dep and preload to ensure that vite-preloading occurs
    rollupOptions: {
      input: [
        resolve(__dirname, 'index.html'),
        resolve(__dirname, 'preload.js'),
        resolve(__dirname, 'dep.js')
      ],
      // use simple entry names for easier reference inside the tests
      output: {
        entryFileNames: 'assets/[name].js'
      }
    }
  }
}
