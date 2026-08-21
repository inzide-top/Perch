import { defineStore } from 'pinia'
import {
  chatApi,
  type ChatConversationPage,
  type ChatConversationRecord,
  type ListChatConversationsOptions,
} from '@/services/chat-api'

const chatUiStorageKey = 'agent-seek-employment:chat-ui'

type ChatUiState = {
  isOpen: boolean
  width: number
  selectedConversationId: string | null
}

type ChatHistoryQuery = Omit<ListChatConversationsOptions, 'cursor'>

function readUiState(): Partial<ChatUiState> {
  if (typeof localStorage === 'undefined') return {}

  try {
    const value = JSON.parse(localStorage.getItem(chatUiStorageKey) ?? '{}') as Partial<ChatUiState>
    return value && typeof value === 'object' ? value : {}
  } catch {
    localStorage.removeItem(chatUiStorageKey)
    return {}
  }
}

function persistUiState(state: ChatUiState) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(chatUiStorageKey, JSON.stringify(state))
}

function normalizeHistoryQuery(query: ChatHistoryQuery): ChatHistoryQuery {
  return {
    limit: query.limit ?? 20,
    archived: query.archived ?? 'active',
    ...(query.search ? { search: query.search.trim() } : {}),
    ...(query.scopeType ? { scopeType: query.scopeType } : {}),
    ...(query.opportunityId ? { opportunityId: query.opportunityId } : {}),
  }
}

function getHistoryQueryKey(query: ChatHistoryQuery) {
  return JSON.stringify(normalizeHistoryQuery(query))
}

export const useChatStore = defineStore('chat', {
  state: (): ChatUiState & {
    conversations: ChatConversationRecord[]
    historyConversationIds: string[]
    historyQuery: ChatHistoryQuery
    historyQueryKey: string
    historyNextCursor: string | null
    historyHasMore: boolean
    historyTotal: number
    isLoadingConversations: boolean
    isLoadingMoreConversations: boolean
    hasLoadedConversations: boolean
    error: string | null
  } => {
    const stored = readUiState()
    const initialHistoryQuery = normalizeHistoryQuery({})
    return {
      isOpen: stored.isOpen ?? true,
      width: Math.min(720, Math.max(360, stored.width ?? 440)),
      selectedConversationId: typeof stored.selectedConversationId === 'string' ? stored.selectedConversationId : null,
      conversations: [],
      historyConversationIds: [],
      historyQuery: initialHistoryQuery,
      historyQueryKey: getHistoryQueryKey(initialHistoryQuery),
      historyNextCursor: null,
      historyHasMore: false,
      historyTotal: 0,
      isLoadingConversations: false,
      isLoadingMoreConversations: false,
      hasLoadedConversations: false,
      error: null,
    }
  },

  getters: {
    selectedConversation(state) {
      return state.conversations.find((item) => item.id === state.selectedConversationId) ?? null
    },
    historyConversations(state) {
      const records = new Map(state.conversations.map((item) => [item.id, item]))
      return state.historyConversationIds.flatMap((id) => records.get(id) ?? [])
    },
  },

  actions: {
    persistUiState() {
      persistUiState({
        isOpen: this.isOpen,
        width: this.width,
        selectedConversationId: this.selectedConversationId,
      })
    },

    setOpen(isOpen: boolean) {
      this.isOpen = isOpen
      this.persistUiState()
    },

    setWidth(width: number) {
      this.width = Math.min(720, Math.max(360, Math.round(width)))
      this.persistUiState()
    },

    upsertConversation(conversation: ChatConversationRecord) {
      const index = this.conversations.findIndex((item) => item.id === conversation.id)
      if (index === -1) this.conversations.unshift(conversation)
      else this.conversations[index] = conversation
    },

    hydrateConversationPage(page: ChatConversationPage, query: ChatHistoryQuery = {}) {
      const normalizedQuery = normalizeHistoryQuery(query)
      page.items.forEach((conversation) => this.upsertConversation(conversation))
      this.historyConversationIds = page.items.map((conversation) => conversation.id)
      this.historyQuery = normalizedQuery
      this.historyQueryKey = getHistoryQueryKey(normalizedQuery)
      this.historyNextCursor = page.nextCursor
      this.historyHasMore = page.hasMore
      this.historyTotal = page.total
      this.hasLoadedConversations = true
      this.error = null
    },

    async loadConversations(query: ChatHistoryQuery = {}, force = false) {
      const normalizedQuery = normalizeHistoryQuery(query)
      const queryKey = getHistoryQueryKey(normalizedQuery)
      if (this.isLoadingConversations || (!force && this.hasLoadedConversations && this.historyQueryKey === queryKey)) {
        return this.historyConversations
      }

      this.isLoadingConversations = true
      this.error = null
      try {
        const page = await chatApi.listConversations(normalizedQuery)
        page.items.forEach((conversation) => this.upsertConversation(conversation))
        this.historyConversationIds = page.items.map((conversation) => conversation.id)
        this.historyQuery = normalizedQuery
        this.historyQueryKey = queryKey
        this.historyNextCursor = page.nextCursor
        this.historyHasMore = page.hasMore
        this.historyTotal = page.total
        this.hasLoadedConversations = true
        return page.items
      } catch (error) {
        this.error = error instanceof Error ? error.message : '加载对话列表失败'
        throw error
      } finally {
        this.isLoadingConversations = false
      }
    },

    async loadMoreConversations() {
      if (
        this.isLoadingConversations ||
        this.isLoadingMoreConversations ||
        !this.historyHasMore ||
        !this.historyNextCursor
      )
        return this.historyConversations

      this.isLoadingMoreConversations = true
      this.error = null
      try {
        const page = await chatApi.listConversations({
          ...this.historyQuery,
          cursor: this.historyNextCursor,
        })
        page.items.forEach((conversation) => this.upsertConversation(conversation))
        this.historyConversationIds = [
          ...this.historyConversationIds,
          ...page.items
            .map((conversation) => conversation.id)
            .filter((id) => !this.historyConversationIds.includes(id)),
        ]
        this.historyNextCursor = page.nextCursor
        this.historyHasMore = page.hasMore
        this.historyTotal = page.total
        return page.items
      } catch (error) {
        this.error = error instanceof Error ? error.message : '加载更多对话失败'
        throw error
      } finally {
        this.isLoadingMoreConversations = false
      }
    },

    selectConversation(conversationId: string | null) {
      this.selectedConversationId = conversationId
      this.persistUiState()
    },

    async createConversation(input: {
      title: string
      scopeType: 'global' | 'opportunity'
      opportunityId?: string | null
    }) {
      const conversation = await chatApi.createConversation(input)
      this.upsertConversation(conversation)
      this.selectConversation(conversation.id)
      return conversation
    },

    async updateConversation(conversationId: string, input: { title?: string; archived?: boolean }) {
      this.error = null
      try {
        const conversation = await chatApi.updateConversation(conversationId, input)
        this.upsertConversation(conversation)
        return conversation
      } catch (error) {
        this.error = error instanceof Error ? error.message : '更新对话失败'
        throw error
      }
    },

    async deleteConversation(conversationId: string) {
      this.error = null
      try {
        await chatApi.deleteConversation(conversationId)
        this.conversations = this.conversations.filter((item) => item.id !== conversationId)
        this.historyConversationIds = this.historyConversationIds.filter((id) => id !== conversationId)
        this.historyTotal = Math.max(0, this.historyTotal - 1)
        if (this.selectedConversationId === conversationId) this.selectConversation(null)
      } catch (error) {
        this.error = error instanceof Error ? error.message : '删除对话失败'
        throw error
      }
    },
  },
})
