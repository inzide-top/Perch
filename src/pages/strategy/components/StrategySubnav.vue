<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()

const items = [
  { label: '能力画像', to: '/strategy', icon: 'i-lucide-scan-search', description: '已有证据' },
  { label: '行动策略', to: '/strategy/actions', icon: 'i-lucide-compass', description: '下一步行动' },
]

function isActive(path: string) {
  return route.path === path
}
</script>

<template>
  <nav class="strategy-subnav" aria-label="求职策略模块" role="navigation">
    <div class="strategy-subnav__context">
      <span class="strategy-subnav__mark" aria-hidden="true">
        <UIcon name="i-lucide-compass" class="size-4" />
      </span>
      <div class="min-w-0">
        <p class="text-[11px] font-medium tracking-wide text-muted">求职策略</p>
        <p class="mt-0.5 truncate text-sm font-semibold text-highlighted">证据与行动</p>
      </div>
    </div>

    <div class="strategy-subnav__tabs" role="tablist" aria-label="求职策略视图">
      <RouterLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        role="tab"
        :aria-selected="isActive(item.to)"
        :aria-current="isActive(item.to) ? 'page' : undefined"
        class="strategy-subnav__tab"
        :class="isActive(item.to) ? 'strategy-subnav__tab--active' : ''"
      >
        <UIcon :name="item.icon" class="size-4 shrink-0" />
        <span class="min-w-0">
          <span class="block truncate text-sm font-semibold">{{ item.label }}</span>
          <span class="mt-0.5 block truncate text-[10px] font-normal text-muted">{{ item.description }}</span>
        </span>
      </RouterLink>
    </div>
  </nav>
</template>

<style scoped>
.strategy-subnav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: 4.25rem;
  padding: 0.65rem 0.75rem 0.65rem 1rem;
  border: 1px solid var(--app-border);
  border-radius: 1.25rem;
  background: var(--app-surface);
  box-shadow: 0 8px 24px rgb(15 23 42 / 4%);
}

.strategy-subnav__context {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.65rem;
}

.strategy-subnav__mark {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  color: var(--app-accent-strong);
  border: 1px solid color-mix(in srgb, var(--app-accent-strong) 24%, var(--app-border));
  border-radius: 0.7rem;
  background: color-mix(in srgb, var(--app-accent) 11%, var(--app-surface));
}

.strategy-subnav__tabs {
  display: flex;
  align-items: stretch;
  gap: 0.25rem;
  padding: 0.25rem;
  border: 1px solid var(--app-border);
  border-radius: 0.95rem;
  background: var(--app-surface-muted);
}

.strategy-subnav__tab {
  display: inline-flex;
  min-width: 7.75rem;
  align-items: center;
  gap: 0.55rem;
  padding: 0.55rem 0.75rem;
  color: var(--app-text-muted);
  border: 1px solid transparent;
  border-radius: 0.7rem;
  outline: none;
  transition:
    color var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

.strategy-subnav__tab:hover {
  color: var(--app-text);
  background: color-mix(in srgb, var(--app-surface) 74%, transparent);
}

.strategy-subnav__tab:focus-visible {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--app-accent-strong) 55%, transparent);
}

.strategy-subnav__tab--active {
  color: var(--app-text);
  border-color: color-mix(in srgb, var(--app-accent-strong) 26%, var(--app-border));
  background: var(--app-surface);
  box-shadow: 0 3px 10px rgb(15 23 42 / 7%);
}

@media (max-width: 640px) {
  .strategy-subnav {
    align-items: stretch;
    flex-direction: column;
    gap: 0.7rem;
    padding: 0.75rem;
  }

  .strategy-subnav__tabs {
    width: 100%;
  }

  .strategy-subnav__tab {
    flex: 1 1 0;
    min-width: 0;
  }
}
</style>
