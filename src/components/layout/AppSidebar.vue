<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import perchMarkDarkUrl from '@/assets/brand/perch-mark-dark.png'
import perchMarkLightUrl from '@/assets/brand/perch-mark-light.png'
import { useAuthStore } from '@/stores/auth'

const isExpanded = defineModel<boolean>('expanded', { required: true })
const emit = defineEmits<{ logout: []; feedback: [] }>()
const route = useRoute()
const authStore = useAuthStore()
const isUserMenuOpen = ref(false)

const navigation = [
  { label: '首页', to: '/', icon: 'i-lucide-layout-dashboard' },
  { label: '简历管理', to: '/resumes', icon: 'i-lucide-file-text' },
  { label: '机会管理', to: '/opportunities', icon: 'i-lucide-briefcase-business' },
  { label: '求职策略', to: '/strategy', icon: 'i-lucide-compass' },
  { label: '设置', to: '/settings', icon: 'i-lucide-settings' },
]

const userInitial = computed(() => authStore.user?.displayName.trim().charAt(0).toUpperCase() || 'P')
const userSecondary = computed(() => {
  if (authStore.mode === 'interview') return '共享演示数据'
  if (authStore.mode === 'development') return 'demo-user'
  return authStore.user?.email ?? '已登录'
})

function isNavigationActive(path: string) {
  return route.path === path || route.path.startsWith(`${path}/`)
}

function openFeedback() {
  isUserMenuOpen.value = false
  emit('feedback')
}
</script>

<template>
  <aside
    class="fixed inset-y-0 left-0 z-30 hidden overflow-hidden border-r border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-surface)_92%,transparent)] shadow-[12px_0_34px_rgb(15_23_42/6%)] backdrop-blur-xl transition-[width] [transition-duration:var(--duration-panel)] [transition-timing-function:var(--ease-panel)] lg:block"
    :class="isExpanded ? 'w-64' : 'w-16'"
  >
    <div class="absolute inset-y-0 top-0 left-1 w-16 px-2 py-3.5">
      <RouterLink
        v-if="isExpanded"
        to="/"
        class="flex size-10 items-center justify-center rounded-xl p-0.5 transition-transform hover:scale-[1.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        aria-label="返回首页"
        title="返回首页"
      >
        <img :src="perchMarkLightUrl" alt="PERCH" class="size-full object-contain dark:hidden" />
        <img :src="perchMarkDarkUrl" alt="PERCH" class="hidden size-full object-contain dark:block" />
      </RouterLink>
      <button
        v-else
        type="button"
        class="flex size-10 items-center justify-center rounded-xl p-0.5 transition-transform hover:scale-[1.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        aria-label="打开边栏"
        title="打开边栏"
        @click="isExpanded = true"
      >
        <img :src="perchMarkLightUrl" alt="PERCH" class="size-full object-contain dark:hidden" />
        <img :src="perchMarkDarkUrl" alt="PERCH" class="hidden size-full object-contain dark:block" />
      </button>
    </div>

    <div
      class="absolute inset-y-0 py-3.5 transition-[opacity,transform] [transition-duration:var(--duration-normal)] [transition-timing-function:var(--ease-out)]"
      :class="
        isExpanded
          ? 'left-16 w-48 translate-x-0 pr-3 opacity-100'
          : 'pointer-events-none left-16 w-48 -translate-x-2 pr-3 opacity-0'
      "
    >
      <div class="flex h-10 items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold tracking-tight text-highlighted">PERCH</p>
          <p class="truncate text-[11px] text-muted">AI Career Workspace</p>
        </div>

        <UButton
          type="button"
          color="neutral"
          variant="ghost"
          size="xs"
          icon="i-lucide-panel-left-close"
          aria-label="关闭边栏"
          title="关闭边栏"
          @click="isExpanded = false"
        />
      </div>
    </div>

    <div class="flex h-full flex-col px-2 pb-4 pt-16">
      <nav class="space-y-1">
        <UTooltip
          v-for="item in navigation"
          :key="item.to"
          :text="item.label"
          :disabled="isExpanded"
          :content="{ side: 'right', sideOffset: 12 }"
        >
          <RouterLink
            :to="item.to"
            :data-tour="item.to === '/settings' ? 'settings-navigation' : undefined"
            class="relative flex h-10 items-center rounded-xl text-sm font-medium text-muted transition-[width,background-color,color,box-shadow] [transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-out)] hover:bg-[color-mix(in_srgb,var(--app-accent)_9%,transparent)] hover:text-highlighted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            :class="[
              isExpanded ? 'w-60' : 'w-12',
              isNavigationActive(item.to) ? 'sidebar-nav-active text-highlighted' : '',
            ]"
            :aria-current="isNavigationActive(item.to) ? 'page' : undefined"
          >
            <span class="absolute left-0 top-0 flex h-10 w-12 items-center justify-center">
              <UIcon :name="item.icon" class="size-4 shrink-0" />
            </span>
            <span
              class="absolute left-12 top-0 flex h-10 items-center overflow-hidden whitespace-nowrap transition-[opacity,transform] [transition-duration:var(--duration-normal)] [transition-timing-function:var(--ease-out)]"
              :class="isExpanded ? 'translate-x-0 opacity-100' : 'pointer-events-none -translate-x-1 opacity-0'"
            >
              {{ item.label }}
            </span>
          </RouterLink>
        </UTooltip>
      </nav>

      <div class="mt-auto border-t border-default pt-3">
        <UPopover
          v-model:open="isUserMenuOpen"
          :portal="true"
          :content="{ side: 'right', align: 'end', sideOffset: 12 }"
          :ui="{ content: 'app-popover-layer w-64 p-2' }"
        >
          <UTooltip
            :text="authStore.user?.displayName ?? '当前用户'"
            :disabled="isExpanded || isUserMenuOpen"
            :content="{ side: 'right', sideOffset: 12 }"
          >
            <button
              type="button"
              class="relative flex h-12 items-center rounded-xl text-left transition-[width,background-color,box-shadow] [transition-duration:var(--duration-fast)] hover:bg-[var(--app-accent-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              :class="[isExpanded ? 'w-60' : 'w-12', isUserMenuOpen ? 'bg-[var(--app-accent-soft)]' : '']"
              :aria-label="`当前用户：${authStore.user?.displayName ?? 'PERCH 用户'}`"
            >
              <span
                class="absolute left-1.5 top-1.5 flex size-9 items-center justify-center rounded-xl border border-[var(--app-border-strong)] bg-[var(--app-surface)] text-sm font-semibold text-[var(--app-accent-deep)] shadow-sm"
              >
                {{ userInitial }}
              </span>
              <span
                class="absolute left-12 right-7 top-0 flex h-12 min-w-0 flex-col justify-center transition-[opacity,transform] [transition-duration:var(--duration-normal)]"
                :class="isExpanded ? 'translate-x-0 opacity-100' : 'pointer-events-none -translate-x-1 opacity-0'"
              >
                <span class="truncate text-sm font-medium text-highlighted">{{ authStore.user?.displayName }}</span>
                <span class="truncate text-[11px] text-muted">{{ userSecondary }}</span>
              </span>
              <UIcon
                name="i-lucide-chevrons-up-down"
                class="absolute right-2.5 size-3.5 text-dimmed transition-opacity"
                :class="isExpanded ? 'opacity-100' : 'opacity-0'"
              />
            </button>
          </UTooltip>

          <template #content>
            <div class="border-b border-default px-2 pb-2.5 pt-1.5">
              <p class="truncate text-sm font-medium text-highlighted">{{ authStore.user?.displayName }}</p>
              <p class="mt-0.5 truncate text-xs text-muted">{{ userSecondary }}</p>
            </div>
            <div v-if="authStore.mode === 'interview'" class="px-2 py-3 text-xs leading-5 text-muted">
              当前为面试官体验环境，所有体验者使用共享演示数据。
            </div>
            <div v-else-if="authStore.mode === 'development'" class="px-2 py-3 text-xs leading-5 text-muted">
              当前为本地开发身份，不经过正式登录流程。
            </div>
            <div class="mt-1 border-t border-default pt-1">
              <button
                type="button"
                class="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-sm text-muted transition-colors hover:bg-[var(--app-accent-soft)] hover:text-highlighted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                @click="openFeedback"
              >
                <UIcon name="i-lucide-message-square-text" class="size-4" />
                提交反馈
              </button>
            </div>
            <button
              v-if="authStore.mode === 'supabase'"
              type="button"
              class="mt-1 flex h-9 w-full items-center gap-2 rounded-lg px-2 text-sm text-muted transition-colors hover:bg-error/10 hover:text-error focus:outline-none focus-visible:ring-2 focus-visible:ring-error/50"
              @click="emit('logout')"
            >
              <UIcon name="i-lucide-log-out" class="size-4" />
              退出登录
            </button>
          </template>
        </UPopover>
      </div>
    </div>
  </aside>
</template>
