const vuePlugin = require('@vitejs/plugin-vue')
const vueJsx = require('@vitejs/plugin-vue-jsx')

module.exports.getViteConfig = getViteConfig

function getViteConfig(root) {
  return {
    root,
    configFile: false,
    ssr: { external: ['vue-framework'] },
    plugins: [vuePlugin(), vueJsx()]
  }
}
