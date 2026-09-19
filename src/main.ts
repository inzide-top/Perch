import { createApp } from 'vue'
import './style.css'
import { createPinia } from 'pinia'
import ui from '@nuxt/ui/vue-plugin'
import App from './App.vue'
import router from './router'
import { useAuthStore, useOpportunityStore, useResumeStore } from './stores'
import { developerToolsEnabled } from './services/developer-tools'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)

const authStore = useAuthStore(pinia)
const opportunityStore = useOpportunityStore(pinia)
const resumeStore = useResumeStore(pinia)

router.beforeEach(async (to) => {
  await authStore.initialize()

  const isPublicOnly = to.matched.some((item) => item.meta.publicOnly)
  const isAuthRecovery = to.matched.some((item) => item.meta.authRecovery)
  if (authStore.isAuthenticated && isPublicOnly && !isAuthRecovery) {
    const redirect = typeof to.query.redirect === 'string' ? to.query.redirect : '/'
    return redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/'
  }

  if (!authStore.isAuthenticated && !isPublicOnly) {
    return {
      name: 'auth',
      query: { redirect: to.fullPath },
    }
  }

  const isDeveloperPage = to.matched.some((item) => item.meta.developerPage)
  if (isDeveloperPage && !developerToolsEnabled) {
    return { name: 'settings' }
  }

  if (to.name === 'opportunities') {
    await opportunityStore.loadOpportunities()
  } else if (to.name === 'resumes') {
    await resumeStore.loadFromApi()
  }

  return true
})

app.use(router)
app.use(ui)
app.mount('#app')
