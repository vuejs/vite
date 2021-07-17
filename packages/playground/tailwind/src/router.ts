import { createWebHistory, createRouter } from 'vue-router'
import Page from './views/Page.vue'

const history = createWebHistory()

const routeur = createRouter({
  history: history,
  routes: [
    {
      path: '/',
      component: Page
    }
  ]
})

export default routeur
