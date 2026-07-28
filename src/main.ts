import { createApp } from 'vue'
import './style.css'
import { createPinia } from 'pinia'
import ui from '@nuxt/ui/vue-plugin'
import App from './App.vue'
import router from './router'
import { useOpportunityStore, useResumeStore, useSettingsStore } from './stores'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.use(ui)

useResumeStore(pinia).hydrateFromStorage()
useOpportunityStore(pinia).hydrateFromStorage()
useSettingsStore(pinia).hydrateFromStorage()

app.mount('#app')
