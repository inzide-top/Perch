<script setup lang="ts">
import { ref } from 'vue'
import type { ChatConversationRecord } from '@/services/chat-api'

export type ChatHistoryScopeFilter = 'all' | 'global' | 'current_opportunity'
export type ChatConversationMutation = 'rename' | 'archive' | 'delete'

defineProps<{
  panelTitle: string
  total: number
  scopeItems: Array<{ label: string; value: ChatHistoryScopeFilter; disabled?: boolean }>
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  conversations: ChatConversationRecord[]
  selectedConversationId: string | null
  mutationPending: boolean
  editingConversationId: string | null
  editingConversationTitle: string
  conversationMutation: { conversationId: string; type: ChatConversationMutation } | null
  deletePopoverConversationId: string | null
  getConversationScopeLabel: (conversation: ChatConversationRecord) => string
  formatConversationTime: (value: string | null) => string
}>()

const emit = defineEmits<{
  select: [conversationId: string]
  beginRename: [conversation: ChatConversationRecord]
  saveRename: [conversationId: string]
  cancelRename: []
  toggleArchive: [conversation: ChatConversationRecord]
  remove: [conversation: ChatConversationRecord]
  loadMore: []
  setDeletePopoverOpen: [conversationId: string, open: boolean]
  'update:editingConversationTitle': [value: string]
}>()

const search = defineModel<string>('search', { required: true })
const showArchived = defineModel<boolean>('showArchived', { required: true })
const scopeFilter = defineModel<ChatHistoryScopeFilter>('scopeFilter', { required: true })
const searchExpanded = ref(false)
const searchFocused = ref(false)

function collapseSearch() {
  if (searchFocused.value || search.value.trim()) return
  searchExpanded.value = false
}

function handleSearchBlur() {
  searchFocused.value = false
  window.setTimeout(collapseSearch, 80)
}
</script>

<template>
  <section
    class="overflow-hidden border-b border-default bg-[color-mix(in_srgb,var(--app-surface-muted)_64%,var(--app-surface))]"
    aria-label="历史对话"
  >
    <div class="px-3 pb-3 pt-3">
      <div class="flex h-9 items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="text-xs font-medium text-highlighted">{{ panelTitle }}</p>
          <p class="text-[10px] text-muted">{{ total }} 条记录</p>
        </div>

        <div class="flex shrink-0 items-center gap-1">
          <div
            class="relative flex h-8 items-center justify-end transition-[width] duration-[360ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
            :class="searchExpanded || search.trim() ? 'w-48' : 'w-8'"
            @mouseenter="searchExpanded = true"
            @mouseleave="collapseSearch"
          >
            <UInput
              v-if="searchExpanded || search.trim()"
              v-model="search"
              size="xs"
              class="w-full"
              icon="i-lucide-search"
              placeholder="搜索对话"
              aria-label="搜索历史对话"
              @focus="searchFocused = true"
              @blur="handleSearchBlur"
            />
            <UTooltip v-else text="搜索历史对话">
              <UButton
                type="button"
                color="neutral"
                variant="ghost"
                size="xs"
                square
                icon="i-lucide-search"
                aria-label="搜索历史对话"
                @focus="searchExpanded = true"
              />
            </UTooltip>
          </div>

          <UTooltip :text="showArchived ? '收起已归档对话' : '展开已归档对话'">
            <UButton
              type="button"
              :color="showArchived ? 'primary' : 'neutral'"
              :variant="showArchived ? 'soft' : 'ghost'"
              size="xs"
              square
              icon="i-lucide-archive"
              :class="
                showArchived ? 'bg-primary/15 text-primary ring-1 ring-inset ring-primary/20 hover:bg-primary/20' : ''
              "
              :aria-pressed="showArchived"
              aria-label="切换归档对话"
              @click="showArchived = !showArchived"
            />
          </UTooltip>
        </div>
      </div>

      <UTabs
        v-model="scopeFilter"
        :items="scopeItems"
        :content="false"
        color="primary"
        variant="link"
        size="xs"
        class="mt-2 w-full"
        :ui="{
          list: 'grid w-full grid-cols-3 border-b border-default bg-transparent p-0',
          trigger: 'min-w-0 justify-center rounded-none px-2 py-2 text-xs transition-colors',
          indicator: 'h-0.5 bg-primary',
        }"
      />

      <div
        class="mt-2 max-h-[min(23rem,48vh)] space-y-1.5 overflow-y-auto overscroll-contain pr-0.5 transition-opacity"
        :class="mutationPending ? 'pointer-events-none opacity-45' : ''"
        :aria-busy="mutationPending"
      >
        <template v-if="loading">
          <div
            v-for="index in 3"
            :key="index"
            class="h-16 animate-pulse rounded-xl border border-default bg-[var(--app-surface)]"
          />
        </template>

        <div
          v-for="conversation in conversations"
          v-else
          :key="conversation.id"
          class="group flex min-h-16 w-full items-center gap-1 rounded-xl border px-2.5 py-2 shadow-[0_1px_2px_rgb(15_23_42/3%)] transition-[border-color,background-color,box-shadow,opacity]"
          :class="
            conversation.id === selectedConversationId
              ? 'border-primary/30 bg-primary/8 text-highlighted shadow-[0_4px_14px_color-mix(in_srgb,var(--app-accent)_8%,transparent)]'
              : 'border-default/80 bg-[color-mix(in_srgb,var(--app-surface)_88%,transparent)] text-muted hover:border-primary/20 hover:bg-[var(--app-surface)] hover:text-highlighted'
          "
        >
          <button
            type="button"
            class="min-w-0 flex-1 rounded-lg px-1 py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            :disabled="mutationPending || editingConversationId === conversation.id"
            @click="emit('select', conversation.id)"
          >
            <div class="flex min-h-11 min-w-0 flex-col justify-center">
              <UInput
                v-if="editingConversationId === conversation.id"
                :model-value="editingConversationTitle"
                size="xs"
                class="w-full"
                aria-label="编辑会话名称"
                @update:model-value="emit('update:editingConversationTitle', String($event))"
                @click.stop
                @keydown.enter.prevent="emit('saveRename', conversation.id)"
                @keydown.esc.prevent="emit('cancelRename')"
              />
              <span v-else class="block truncate text-sm font-medium">{{ conversation.title }}</span>
              <span class="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] opacity-75">
                <span class="truncate">{{ getConversationScopeLabel(conversation) }}</span>
                <span aria-hidden="true">·</span>
                <span class="shrink-0">{{ formatConversationTime(conversation.lastMessageAt) }}</span>
                <span v-if="conversation.archivedAt" class="shrink-0">· 已归档</span>
              </span>
            </div>
          </button>

          <div
            class="flex shrink-0 items-center gap-0.5 transition-opacity"
            :class="
              editingConversationId === conversation.id
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
            "
          >
            <template v-if="editingConversationId === conversation.id">
              <UButton
                type="button"
                color="primary"
                variant="ghost"
                size="xs"
                square
                icon="i-lucide-check"
                aria-label="保存会话名称"
                title="保存名称"
                @click.stop="emit('saveRename', conversation.id)"
              />
              <UButton
                type="button"
                color="neutral"
                variant="ghost"
                size="xs"
                square
                icon="i-lucide-x"
                aria-label="取消编辑会话名称"
                title="取消编辑"
                @click.stop="emit('cancelRename')"
              />
            </template>
            <template v-else>
              <UButton
                type="button"
                color="neutral"
                variant="ghost"
                size="xs"
                square
                icon="i-lucide-pencil"
                aria-label="重命名会话"
                title="重命名"
                @click.stop="emit('beginRename', conversation)"
              />
              <UButton
                type="button"
                color="neutral"
                variant="ghost"
                size="xs"
                square
                :icon="conversation.archivedAt ? 'i-lucide-archive-restore' : 'i-lucide-archive'"
                :aria-label="conversation.archivedAt ? '取消归档会话' : '归档会话'"
                :title="conversation.archivedAt ? '取消归档' : '归档'"
                @click.stop="emit('toggleArchive', conversation)"
              />
              <UPopover
                :open="deletePopoverConversationId === conversation.id"
                :portal="true"
                :ui="{ content: 'app-popover-layer' }"
                @update:open="emit('setDeletePopoverOpen', conversation.id, $event)"
              >
                <UButton
                  type="button"
                  color="error"
                  variant="ghost"
                  size="xs"
                  square
                  icon="i-lucide-trash-2"
                  aria-label="删除会话"
                  title="删除会话"
                />
                <template #content>
                  <div class="w-64 p-3">
                    <p class="text-sm font-medium text-highlighted">删除这段对话？</p>
                    <p class="mt-1 text-xs leading-5 text-muted">
                      “{{ conversation.title }}”及其消息记录会被永久删除，无法恢复。
                    </p>
                    <div class="mt-3 flex justify-end gap-2">
                      <UButton
                        type="button"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        @click="emit('setDeletePopoverOpen', conversation.id, false)"
                      >
                        取消
                      </UButton>
                      <UButton
                        type="button"
                        color="error"
                        variant="solid"
                        size="sm"
                        :loading="
                          conversationMutation?.conversationId === conversation.id &&
                          conversationMutation?.type === 'delete'
                        "
                        @click="emit('remove', conversation)"
                      >
                        确认删除
                      </UButton>
                    </div>
                  </div>
                </template>
              </UPopover>
            </template>
          </div>
        </div>

        <p v-if="!loading && conversations.length === 0" class="px-3 py-5 text-center text-xs text-muted">
          {{ search.trim() ? '没有匹配的对话。' : showArchived ? '还没有归档对话。' : '当前筛选下还没有对话。' }}
        </p>

        <div v-if="!loading && hasMore" class="flex justify-center pt-1">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            size="xs"
            :loading="loadingMore"
            @click="emit('loadMore')"
          >
            加载更多
          </UButton>
        </div>
      </div>
    </div>
  </section>
</template>
