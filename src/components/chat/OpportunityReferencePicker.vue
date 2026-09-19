<script setup lang="ts">
import { getUserErrorMessage } from '@/services/error-presentation'
import { computed, ref, watch } from 'vue'
import { opportunityApi, type JobOpportunityListItem } from '@/services/opportunities'

const props = withDefaults(
  defineProps<{
    selectedIds: string[]
    excludedOpportunityId?: string | null
    disabled?: boolean
    max?: number
  }>(),
  {
    excludedOpportunityId: null,
    disabled: false,
    max: 5,
  },
)

const emit = defineEmits<{
  select: [opportunity: JobOpportunityListItem]
}>()

const open = ref(false)
const search = ref('')
const opportunities = ref<JobOpportunityListItem[]>([])
const isLoading = ref(false)
const loadError = ref<string | null>(null)
let loaded = false

const maxReached = computed(() => props.selectedIds.length >= props.max)
const normalizedSearch = computed(() => search.value.trim().toLocaleLowerCase('zh-CN'))
const availableOpportunities = computed(() => {
  const selectedIds = new Set(props.selectedIds)
  return opportunities.value.filter((opportunity) => {
    if (selectedIds.has(opportunity.id) || opportunity.id === props.excludedOpportunityId) return false
    if (!normalizedSearch.value) return true
    return `${opportunity.company} ${opportunity.jobTitle}`.toLocaleLowerCase('zh-CN').includes(normalizedSearch.value)
  })
})

async function loadOpportunities(force = false) {
  if ((loaded && !force) || isLoading.value) return
  isLoading.value = true
  loadError.value = null
  try {
    opportunities.value = await opportunityApi.getOpportunities()
    loaded = true
  } catch (error) {
    loadError.value = getUserErrorMessage(error, '机会列表加载失败')
  } finally {
    isLoading.value = false
  }
}

function selectOpportunity(opportunity: JobOpportunityListItem) {
  if (maxReached.value || props.disabled) return
  emit('select', opportunity)
  search.value = ''
  if (props.selectedIds.length + 1 >= props.max) open.value = false
}

function show() {
  if (props.disabled) return
  open.value = true
}

watch(open, (isOpen) => {
  if (isOpen) void loadOpportunities()
  else search.value = ''
})

defineExpose({ show })
</script>

<template>
  <UPopover v-model:open="open" :portal="true" :ui="{ content: 'app-popover-layer' }">
    <UButton
      type="button"
      color="neutral"
      variant="ghost"
      size="xs"
      icon="i-lucide-at-sign"
      :disabled="disabled"
      :aria-label="selectedIds.length ? `已引用 ${selectedIds.length} 个机会` : '引用机会'"
      title="引用机会（@）"
    >
      <span class="hidden sm:inline">引用</span>
      <span v-if="selectedIds.length" class="text-[10px] text-primary">{{ selectedIds.length }}</span>
    </UButton>

    <template #content>
      <section class="w-[min(22rem,calc(100vw-2rem))] p-3" aria-label="选择要引用的机会">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-medium text-highlighted">引用机会</p>
            <p class="mt-0.5 text-[11px] leading-4 text-muted">只为下一条消息补充上下文，最多 {{ max }} 个。</p>
          </div>
          <span class="shrink-0 text-[11px] text-muted">{{ selectedIds.length }}/{{ max }}</span>
        </div>

        <UInput
          v-model="search"
          class="mt-3 w-full"
          size="sm"
          icon="i-lucide-search"
          placeholder="搜索公司或岗位"
          :disabled="isLoading"
          autofocus
        />

        <div class="mt-2 max-h-72 overflow-y-auto overscroll-contain pr-0.5">
          <template v-if="isLoading">
            <div v-for="index in 3" :key="index" class="mb-1.5 h-12 animate-pulse rounded-xl bg-elevated" />
          </template>

          <div v-else-if="loadError" class="rounded-xl border border-error/20 bg-error/5 px-3 py-4 text-center">
            <p class="text-xs text-error">{{ loadError }}</p>
            <UButton class="mt-2" type="button" color="error" variant="link" size="xs" @click="loadOpportunities(true)">
              重新加载
            </UButton>
          </div>

          <div v-else-if="maxReached" class="rounded-xl border border-dashed border-default px-3 py-4 text-center">
            <p class="text-xs text-muted">每条消息最多引用 {{ max }} 个机会</p>
          </div>

          <div
            v-else-if="availableOpportunities.length === 0"
            class="rounded-xl border border-dashed border-default px-3 py-4 text-center"
          >
            <p class="text-xs text-muted">
              {{ opportunities.length === 0 ? '还没有可引用的机会' : '没有更多匹配的机会' }}
            </p>
          </div>

          <button
            v-for="opportunity in availableOpportunities"
            v-else
            :key="opportunity.id"
            type="button"
            class="mb-1.5 flex w-full items-center gap-2 rounded-xl border border-transparent px-2.5 py-2 text-left transition-colors hover:border-primary/20 hover:bg-primary/7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            @click="selectOpportunity(opportunity)"
          >
            <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/8 text-primary">
              <UIcon name="i-lucide-briefcase-business" class="size-4" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-xs font-medium text-highlighted">{{ opportunity.company }}</span>
              <span class="mt-0.5 block truncate text-[11px] text-muted">{{ opportunity.jobTitle }}</span>
            </span>
            <UIcon name="i-lucide-plus" class="size-3.5 shrink-0 text-muted" />
          </button>
        </div>
      </section>
    </template>
  </UPopover>
</template>
