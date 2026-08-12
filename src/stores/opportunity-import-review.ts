import { defineStore } from 'pinia'
import { chatOpportunityImportResultPartSchema, type ChatOpportunityImportResultPart } from '@/shared/chat/schemas'

export const useOpportunityImportReviewStore = defineStore('opportunity-import-review', {
  state: (): {
    payload: ChatOpportunityImportResultPart | null
    sourceMessageId: string | null
    createdItemsByMessageId: Record<string, Record<number, string>>
    revision: number
  } => ({
    payload: null,
    sourceMessageId: null,
    createdItemsByMessageId: {},
    revision: 0,
  }),

  actions: {
    open(payload: ChatOpportunityImportResultPart, sourceMessageId: string) {
      // 聊天消息来自 Vue/Pinia 的响应式对象，不能直接 structuredClone Proxy。
      // Schema.parse 会完成边界校验，并返回一份可安全跨页面传递的普通数据快照。
      const parsed = chatOpportunityImportResultPartSchema.parse(payload)
      const localCompletions = this.createdItemsByMessageId[sourceMessageId] ?? {}
      this.payload = {
        ...parsed,
        items: parsed.items.map((item, itemIndex) => {
          const createdOpportunityId = localCompletions[itemIndex]
          if (item.status !== 'ready' || !createdOpportunityId) return item
          return { ...item, createdOpportunityId, createdAt: item.createdAt ?? new Date().toISOString() }
        }),
      }
      this.sourceMessageId = sourceMessageId
      this.revision += 1
    },

    markCreated(sourceMessageId: string, items: Array<{ itemIndex: number; opportunityId: string }>) {
      const current = { ...(this.createdItemsByMessageId[sourceMessageId] ?? {}) }
      for (const item of items) current[item.itemIndex] = item.opportunityId
      this.createdItemsByMessageId[sourceMessageId] = current

      if (this.sourceMessageId !== sourceMessageId || !this.payload) return
      this.payload = {
        ...this.payload,
        items: this.payload.items.map((item, itemIndex) => {
          const opportunityId = current[itemIndex]
          if (item.status !== 'ready' || !opportunityId) return item
          return { ...item, createdOpportunityId: opportunityId, createdAt: new Date().toISOString() }
        }),
      }
    },

    clear() {
      this.payload = null
      this.sourceMessageId = null
    },
  },
})
