const path = require('path')
const vuePlugin = require('@vitejs/plugin-vue')

/**
 * @type {import('vite').UserConfig}
 */
module.exports = {
  plugins: [vuePlugin()],
  build: {
    minify: false,
    rollupOptions: {
      output: {
        // force into separate chunk to demonstrate
        manualChunks: process.env.SSR
          ? undefined
          : (id, { getModuleInfo }) => {
              if (id.includes('static-import')) {
                return 'static-import'
              }
            }
      }
    }
  }
}
