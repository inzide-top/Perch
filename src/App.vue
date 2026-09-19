<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppHeader from '@/components/layout/AppHeader.vue'
import AppMobileNavigation from '@/components/layout/AppMobileNavigation.vue'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import BackgroundTaskToastHost from '@/components/layout/BackgroundTaskToastHost.vue'
import GlobalChatAssistantShell from '@/components/chat/GlobalChatAssistantShell.vue'
import AppFeedbackModal from '@/components/feedback/AppFeedbackModal.vue'
import { useAuthStore, useOpportunityStore, useResumeStore, useSettingsStore } from '@/stores'
import { useChatStore } from '@/stores/chat'
import { useBackgroundTaskStore } from '@/stores/background-tasks'
import { setupBackgroundTaskSync, teardownBackgroundTaskSync } from '@/services/background-task-sync'

const route = useRoute()
const router = useRouter()
const settingsStore = useSettingsStore()
const authStore = useAuthStore()
const resumeStore = useResumeStore()
const opportunityStore = useOpportunityStore()
const chatStore = useChatStore()
const backgroundTaskStore = useBackgroundTaskStore()
const systemPrefersDark = ref(
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
)
const sidebarPreferenceStorageKey = 'agent-seek-employment:sidebar-expanded'
const preferredSidebarExpanded = ref(readSidebarPreference())
const isMobileNavigationOpen = ref(false)
const isFeedbackOpen = ref(false)
const isSidebarExpanded = ref(
  route.matched.some((item) => item.meta.workspacePage) ? false : preferredSidebarExpanded.value,
)
const pageTitle = computed(() => String(route.meta.title ?? 'PERCH'))
const isWorkspacePage = computed(() => route.matched.some((item) => item.meta.workspacePage))
const isDeveloperPage = computed(() => route.matched.some((item) => item.meta.developerPage))
const isAuthPage = computed(() => route.matched.some((item) => item.meta.authPage))
const layoutOffsetClass = computed(() => (isSidebarExpanded.value ? 'lg:pl-64' : 'lg:pl-16'))
const isDark = computed(() =>
  settingsStore.themeMode === 'system' ? systemPrefersDark.value : settingsStore.themeMode === 'dark',
)
const isModelReady = computed(() => {
  const { baseUrl, modelName, apiKey } = settingsStore.llm
  return Boolean(baseUrl.trim() && modelName.trim() && apiKey.trim())
})
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1440)
const shouldLoadChatAssistant = ref(false)
const GlobalChatAssistant = defineAsyncComponent({
  loader: () => import('@/components/chat/GlobalChatAssistant.vue'),
  loadingComponent: GlobalChatAssistantShell,
  delay: 0,
})
const AppOnboardingTour = defineAsyncComponent({
  loader: () => import('@/components/onboarding/AppOnboardingTour.vue'),
  delay: 0,
})
const chatLayoutStyle = computed(() => {
  if (!chatStore.isOpen || viewportWidth.value < 1024) return undefined
  return { paddingRight: `${chatStore.width}px` }
})

let systemThemeQuery: MediaQueryList | null = null
let appRuntimeStarted = false

function readSidebarPreference() {
  if (typeof localStorage === 'undefined') return true

  return localStorage.getItem(sidebarPreferenceStorageKey) !== 'collapsed'
}

function syncSystemThemePreference(event?: MediaQueryListEvent) {
  systemPrefersDark.value = event?.matches ?? systemThemeQuery?.matches ?? false
}

function syncViewportWidth() {
  viewportWidth.value = window.innerWidth
  if (viewportWidth.value >= 1024) isMobileNavigationOpen.value = false
}

function startAppRuntime() {
  if (appRuntimeStarted || !authStore.isAuthenticated) return
  appRuntimeStarted = true
  settingsStore.hydrateFromStorage()
  if (!resumeStore.isLoaded) resumeStore.hydrateFromStorage()
  opportunityStore.hydrateFromStorage()
  void opportunityStore.loadOpportunities()
  void resumeStore.loadFromApi()
  backgroundTaskStore.hydrate()
  setupBackgroundTaskSync()
  backgroundTaskStore.start()

  void nextTick(() => {
    window.requestAnimationFrame(() => {
      shouldLoadChatAssistant.value = true
    })
  })
}

function stopAppRuntime() {
  if (!appRuntimeStarted) return
  appRuntimeStarted = false
  shouldLoadChatAssistant.value = false
  teardownBackgroundTaskSync()
  backgroundTaskStore.stop()
}

async function handleLogout() {
  try {
    await authStore.signOut()
  } finally {
    window.location.assign('/auth')
  }
}

watch(isDark, (enabled) => document.documentElement.classList.toggle('dark', enabled), { immediate: true })
watch(
  pageTitle,
  (title) => {
    document.title = title === 'PERCH' ? 'PERCH' : `${title} · PERCH`
  },
  { immediate: true },
)
watch(
  () => route.fullPath,
  () => {
    isSidebarExpanded.value = isWorkspacePage.value ? false : preferredSidebarExpanded.value
  },
)
watch(isSidebarExpanded, (expanded) => {
  if (isWorkspacePage.value || typeof localStorage === 'undefined') return

  preferredSidebarExpanded.value = expanded
  localStorage.setItem(sidebarPreferenceStorageKey, expanded ? 'expanded' : 'collapsed')
})
watch(
  () => authStore.isAuthenticated,
  (authenticated) => {
    if (authenticated) {
      startAppRuntime()
      return
    }

    stopAppRuntime()
    if (authStore.initialized && !isAuthPage.value) {
      const redirect = encodeURIComponent(route.fullPath)
      window.location.replace(`/auth?redirect=${redirect}`)
    }
  },
  { immediate: true },
)

onMounted(() => {
  startAppRuntime()
  systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
  syncSystemThemePreference()
  systemThemeQuery.addEventListener('change', syncSystemThemePreference)
  window.addEventListener('resize', syncViewportWidth)
})

onBeforeUnmount(() => {
  stopAppRuntime()
  systemThemeQuery?.removeEventListener('change', syncSystemThemePreference)
  window.removeEventListener('resize', syncViewportWidth)
})
</script>

<template>
  <UApp
    :toaster="{
      position: 'top-center',
      progress: false,
      close: false,
      duration: 2_000,
      max: 3,
      ui: {
        viewport: 'z-[220] sm:w-80',
        base: 'gap-2 p-3',
        // Nuxt UI 的 toast 自身通过 data-slot=root 渲染，圆角在全局样式中统一覆盖。
      },
    }"
  >
    <RouterView v-if="isAuthPage" />
    <div
      v-else-if="authStore.status === 'initializing'"
      class="flex min-h-dvh items-center justify-center bg-[var(--app-bg)]"
    >
      <div class="flex flex-col items-center gap-3 text-sm text-muted" role="status">
        <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-primary" />
        正在恢复登录状态
      </div>
    </div>
    <template v-else-if="authStore.isAuthenticated">
      <BackgroundTaskToastHost />
      <AppFeedbackModal v-model:open="isFeedbackOpen" />
      <GlobalChatAssistant v-if="!isDeveloperPage && shouldLoadChatAssistant" />
      <GlobalChatAssistantShell v-else-if="!isDeveloperPage" />
      <RouterView v-if="isDeveloperPage" />
      <div v-else class="app-shell text-default">
        <AppSidebar v-model:expanded="isSidebarExpanded" @feedback="isFeedbackOpen = true" @logout="handleLogout" />
        <AppMobileNavigation
          v-model:open="isMobileNavigationOpen"
          @feedback="isFeedbackOpen = true"
          @logout="handleLogout"
        />
        <div
          class="transition-[padding] [transition-duration:var(--duration-panel)] [transition-timing-function:var(--ease-panel)]"
          :class="layoutOffsetClass"
          :style="chatLayoutStyle"
        >
          <AppHeader
            :title="pageTitle"
            :model-label="settingsStore.llm.modelName"
            :is-model-ready="isModelReady"
            :is-chat-open="chatStore.isOpen"
            :is-navigation-open="isMobileNavigationOpen"
            @toggle-navigation="isMobileNavigationOpen = true"
            @open-settings="router.push('/settings')"
            @toggle-chat="chatStore.setOpen(!chatStore.isOpen)"
          />
          <main id="main-content" tabindex="-1" :class="isWorkspacePage ? 'p-0' : 'px-4 py-6 sm:px-6 lg:px-8'">
            <RouterView v-slot="{ Component, route: viewRoute }">
              <KeepAlive :include="['CapabilityProfilePage', 'ActionStrategyPage']">
                <component
                  :is="Component"
                  :key="
                    viewRoute.name === 'strategy' || viewRoute.name === 'strategy-actions'
                      ? String(viewRoute.name)
                      : viewRoute.fullPath
                  "
                />
              </KeepAlive>
            </RouterView>
          </main>
        </div>
      </div>
      <AppOnboardingTour
        v-if="!isDeveloperPage"
        @open-mobile-navigation="isMobileNavigationOpen = true"
        @close-mobile-navigation="isMobileNavigationOpen = false"
      />
    </template>
  </UApp>
</template>
