import { createRouter, createWebHistory } from 'vue-router'
import Home from './pages/Home.vue'

const routes = [
  {
    path: '/',
    name: 'Home',
    component: Home
  },
  {
    path: '/about',
    name: 'About',
    component: () => import('./pages/About.vue')
  } // Lazy load route component
]

export default createRouter({
  routes,
  history: createWebHistory()
})
