<script setup lang="ts">
import { getUserErrorMessage } from '@/services/error-presentation'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useOpportunityImportReviewStore } from '@/stores'
import type { ChatOpportunityImportResultPart } from '@/shared/chat/schemas'

const props = defineProps<{
  part: ChatOpportunityImportResultPart
  messageId: string
}>()

const route = useRoute()
const router = useRouter()
const reviewStore = useOpportunityImportReviewStore()

const readyItems = computed(() => props.part.items.filter((item) => item.status === 'ready'))
const failedItems = computed(() => props.part.items.filter((item) => item.status === 'failed'))
const createdItems = computed(() => readyItems.value.filter((item) => Boolean(getCreatedOpportunityId(item))))
const pendingReadyItems = computed(() => readyItems.value.filter((item) => !getCreatedOpportunityId(item)))

function getCreatedOpportunityId(item: Extract<ChatOpportunityImportResultPart['items'][number], { status: 'ready' }>) {
  const itemIndex = props.part.items.indexOf(item)
  return item.createdOpportunityId ?? reviewStore.createdItemsByMessageId[props.messageId]?.[itemIndex] ?? null
}

function getReadyTitle(item: Extract<ChatOpportunityImportResultPart['items'][number], { status: 'ready' }>) {
  return [item.preview.company, item.preview.jobTitle].filter(Boolean).join(' · ') || '待补全岗位信息'
}

async function openReviewWorkbench() {
  if (pendingReadyItems.value.length === 0) return

  reviewStore.open(props.part, props.messageId)
  if (route.name !== 'opportunities') {
    await router.push({ name: 'opportunities' })
  }
}
</script>

<template>
  <section class="rounded-2xl border border-default bg-[var(--app-surface-muted)]/55 p-3">
    <div class="flex items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-2">
        <span class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <UIcon name="i-lucide-file-search-2" class="size-3.5" />
        </span>
        <div class="min-w-0">
          <p class="truncate text-xs font-medium text-highlighted">岗位导入结果</p>
          <p class="mt-0.5 text-[10px] text-muted">
            已识别 {{ readyItems.length }} / {{ part.items.length }} 条
            <span v-if="failedItems.length">· {{ failedItems.length }} 条需处理</span>
          </p>
        </div>
      </div>
      <UBadge color="neutral" variant="subtle" :label="part.mode === 'urls' ? '网址导入' : '文本导入'" />
    </div>

    <div class="mt-3 space-y-2">
      <div
        v-for="(item, index) in part.items"
        :key="`${item.sourceUrl ?? item.sourceLabel}-${index}`"
        class="flex min-w-0 items-start gap-2 rounded-xl border border-default bg-[var(--app-surface)] px-3 py-2.5"
      >
        <UIcon
          :name="
            item.status === 'ready' && getCreatedOpportunityId(item)
              ? 'i-lucide-badge-check'
              : item.status === 'ready'
                ? 'i-lucide-circle-check'
                : 'i-lucide-circle-alert'
          "
          class="mt-0.5 size-3.5 shrink-0"
          :class="item.status === 'ready' ? 'text-success' : 'text-error'"
        />
        <div class="min-w-0 flex-1">
          <template v-if="item.status === 'ready'">
            <p class="truncate text-xs font-medium text-highlighted">{{ getReadyTitle(item) }}</p>
            <p class="mt-1 truncate text-[10px] text-muted">{{ item.sourceLabel }}</p>
            <p v-if="getCreatedOpportunityId(item)" class="mt-1 text-[10px] leading-4 text-success">已创建到机会列表</p>
            <p v-if="item.preview.missingRequiredFields.length" class="mt-1 text-[10px] leading-4 text-warning">
              仍需补全 {{ item.preview.missingRequiredFields.length }} 个必填字段
            </p>
          </template>
          <template v-else>
            <p class="truncate text-xs font-medium text-highlighted">{{ item.sourceLabel }}</p>
            <p class="mt-1 line-clamp-2 text-[10px] leading-4 text-error">
              {{ getUserErrorMessage(item.error, '岗位识别失败，请稍后重试。') }}
            </p>
          </template>
        </div>
      </div>
    </div>

    <div class="mt-3 flex items-center justify-between gap-3 border-t border-default pt-3">
      <p class="text-[10px] leading-4 text-muted">
        {{
          pendingReadyItems.length
            ? `还有 ${pendingReadyItems.length} 条结果待审核创建。`
            : createdItems.length
              ? `已创建 ${createdItems.length} 条机会，该结果现为只读。`
              : '没有可创建的识别结果。'
        }}
      </p>
      <UButton
        v-if="pendingReadyItems.length"
        type="button"
        size="xs"
        color="primary"
        variant="solid"
        icon="i-lucide-panel-top-open"
        class="shrink-0"
        @click="openReviewWorkbench"
      >
        审核并创建
      </UButton>
    </div>
  </section>
</template>
