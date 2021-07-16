import { getPages } from './getPages'
import { createSSRApp } from 'vue'

hydrate()

async function hydrate() {
  const pages = await getPages()
  const { pagePath } = window
  const exports = await pages[pagePath]()
  const Page = exports.default
  const app = createSSRApp(Page)
  app.mount('#app')
}
