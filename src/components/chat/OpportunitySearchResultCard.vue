<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { ChatOpportunitySearchResultPart } from '@/shared/chat/schemas'

const props = defineProps<{
  part: ChatOpportunitySearchResultPart
}>()

const router = useRouter()
const expanded = ref(false)
const previewLimit = 5

const visibleItems = computed(() => (expanded.value ? props.part.items : props.part.items.slice(0, previewLimit)))
const hiddenItemCount = computed(() => Math.max(0, props.part.items.length - previewLimit))

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date)
}

function openOpportunity(opportunityId: string) {
  void router.push({ name: 'opportunity-detail', params: { id: opportunityId } })
}

function openAll() {
  const query: Record<string, string> = {}
  if (props.part.query.statuses.length === 1) query.status = props.part.query.statuses[0]!
  if (props.part.query.statuses.length > 1) query.statuses = props.part.query.statuses.join(',')
  if (props.part.query.intentionLevels.length === 1) query.intention = props.part.query.intentionLevels[0]!
  if (props.part.query.intentionLevels.length > 1) {
    query.intentions = props.part.query.intentionLevels.join(',')
  }
  void router.push({ name: 'opportunities', query })
}
</script>

<template>
  <section class="opportunity-result rounded-2xl border border-default bg-[var(--app-surface-muted)]/55 p-3">
    <div class="flex items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-2">
        <span class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <UIcon name="i-lucide-briefcase-business" class="size-3.5" />
        </span>
        <p class="truncate text-xs font-medium text-highlighted">机会查询结果</p>
      </div>
      <span class="shrink-0 text-[11px] text-muted"> 共 {{ part.matchedCount }} 条 </span>
    </div>

    <div
      v-if="part.items.length === 0"
      class="mt-3 rounded-xl border border-dashed border-default px-3 py-4 text-center"
    >
      <p class="text-xs text-muted">没有找到符合条件的机会</p>
      <UButton type="button" color="primary" variant="link" size="xs" class="mt-1" @click="openAll">
        查看全部机会
      </UButton>
    </div>

    <div
      v-else
      class="mt-3 space-y-2"
      :class="expanded && part.items.length > previewLimit ? 'max-h-80 overflow-y-auto pr-1' : ''"
    >
      <button
        v-for="item in visibleItems"
        :key="item.opportunityId"
        type="button"
        class="group flex w-full items-center gap-3 rounded-xl border border-default bg-[var(--app-surface)] px-3 py-2.5 text-left transition-colors hover:border-primary/45 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
        @click="openOpportunity(item.opportunityId)"
      >
        <span class="min-w-0 flex-1">
          <span class="flex min-w-0 items-center gap-2">
            <span class="truncate text-xs font-medium text-highlighted">{{ item.company }}</span>
            <span class="truncate text-[11px] text-muted">{{ item.jobTitle }}</span>
          </span>
          <span class="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-muted">
            <span class="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-primary">{{ item.statusLabel }}</span>
            <span class="shrink-0">意向 {{ item.intentionLevel ?? '未设置' }}</span>
            <span v-if="item.matchScore !== undefined" class="shrink-0">匹配度 {{ item.matchScore }}</span>
            <span v-if="item.address.length" class="truncate">{{ item.address.join('、') }}</span>
          </span>
        </span>
        <span class="flex shrink-0 items-center gap-1 text-[10px] text-muted">
          <span>{{ formatDate(item.updatedAt) }}</span>
          <UIcon name="i-lucide-chevron-right" class="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </button>
    </div>

    <div v-if="hiddenItemCount > 0 || part.hasMore" class="mt-2 flex items-center justify-between gap-2">
      <UButton
        v-if="hiddenItemCount > 0"
        type="button"
        color="neutral"
        variant="link"
        size="xs"
        :icon="expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        @click="expanded = !expanded"
      >
        {{ expanded ? '收起' : `展开剩余 ${hiddenItemCount} 条` }}
      </UButton>
      <UButton
        v-if="part.hasMore"
        type="button"
        color="primary"
        variant="link"
        size="xs"
        class="ml-auto"
        icon="i-lucide-external-link"
        @click="openAll"
      >
        查看全部
      </UButton>
    </div>
  </section>
</template>
