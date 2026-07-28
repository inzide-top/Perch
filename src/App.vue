<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppHeader from '@/components/layout/AppHeader.vue'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import { useSettingsStore } from '@/stores'

const route = useRoute()
const settingsStore = useSettingsStore()
const systemPrefersDark = ref(false)
const sidebarPreferenceStorageKey = 'agent-seek-employment:sidebar-expanded'
const preferredSidebarExpanded = ref(readSidebarPreference())
const isSidebarExpanded = ref(route.name === 'opportunity-detail' ? false : preferredSidebarExpanded.value)
const pageTitle = computed(() => String(route.meta.title ?? 'PERCH'))
const isWorkspacePage = computed(() => route.name === 'opportunity-detail')
const layoutOffsetClass = computed(() => (isSidebarExpanded.value ? 'lg:pl-64' : 'lg:pl-16'))
const isDark = computed(() =>
  settingsStore.themeMode === 'system' ? systemPrefersDark.value : settingsStore.themeMode === 'dark',
)

let systemThemeQuery: MediaQueryList | null = null

function readSidebarPreference() {
  if (typeof localStorage === 'undefined') return true

  return localStorage.getItem(sidebarPreferenceStorageKey) !== 'collapsed'
}

function syncSystemThemePreference(event?: MediaQueryListEvent) {
  systemPrefersDark.value = event?.matches ?? systemThemeQuery?.matches ?? false
}

function toggleThemeMode() {
  settingsStore.setThemeMode(isDark.value ? 'light' : 'dark')
}

watch(isDark, (enabled) => document.documentElement.classList.toggle('dark', enabled), { immediate: true })
watch(
  () => route.name,
  (routeName) => {
    isSidebarExpanded.value = routeName === 'opportunity-detail' ? false : preferredSidebarExpanded.value
  },
)
watch(isSidebarExpanded, (expanded) => {
  if (route.name === 'opportunity-detail' || typeof localStorage === 'undefined') return

  preferredSidebarExpanded.value = expanded
  localStorage.setItem(sidebarPreferenceStorageKey, expanded ? 'expanded' : 'collapsed')
})

onMounted(() => {
  systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
  syncSystemThemePreference()
  systemThemeQuery.addEventListener('change', syncSystemThemePreference)
})

onBeforeUnmount(() => {
  systemThemeQuery?.removeEventListener('change', syncSystemThemePreference)
})
</script>

<template>
  <UApp>
    <div class="app-shell text-default">
      <AppSidebar v-model:expanded="isSidebarExpanded" />
      <div class="transition-[padding] duration-200 ease-out" :class="layoutOffsetClass">
        <AppHeader
          :is-dark="isDark"
          :theme-mode="settingsStore.themeMode"
          :title="pageTitle"
          @toggle-theme="toggleThemeMode"
        />
        <main :class="isWorkspacePage ? 'p-0' : 'px-4 py-6 sm:px-6 lg:px-8'">
          <RouterView />
        </main>
      </div>
    </div>
  </UApp>
</template>
