import { defineStore } from 'pinia'
import { chatOpportunityImportResultPartSchema, type ChatOpportunityImportResultPart } from '@/shared/chat/schemas'

export const useOpportunityImportReviewStore = defineStore('opportunity-import-review', {
  state: (): {
    payload: ChatOpportunityImportResultPart | null
    revision: number
  } => ({
    payload: null,
    revision: 0,
  }),

  actions: {
    open(payload: ChatOpportunityImportResultPart) {
      // 聊天消息来自 Vue/Pinia 的响应式对象，不能直接 structuredClone Proxy。
      // Schema.parse 会完成边界校验，并返回一份可安全跨页面传递的普通数据快照。
      this.payload = chatOpportunityImportResultPartSchema.parse(payload)
      this.revision += 1
    },

    clear() {
      this.payload = null
    },
  },
})
