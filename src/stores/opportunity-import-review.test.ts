import assert from 'node:assert/strict'
import test from 'node:test'
import { reactive } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { ChatOpportunityImportResultPart } from '@/shared/chat/schemas'
import { useOpportunityImportReviewStore } from './opportunity-import-review'

test('响应式聊天结果可以安全转交给岗位审核工作台', () => {
  setActivePinia(createPinia())
  const payload = reactive<ChatOpportunityImportResultPart>({
    type: 'opportunity_import_result',
    mode: 'urls',
    items: [
      {
        status: 'ready',
        sourceLabel: 'jobs.example.com',
        sourceUrl: 'https://jobs.example.com/frontend',
        preview: {
          source: {
            type: 'url',
            label: 'jobs.example.com',
            url: 'https://jobs.example.com/frontend',
          },
          sourceUrl: 'https://jobs.example.com/frontend',
          company: '示例公司',
          jobTitle: '前端工程师',
          address: ['上海'],
          introduction: '负责前端业务。',
          description: '熟悉 Vue。',
          missingRequiredFields: [],
          warning: null,
        },
      },
      {
        status: 'failed',
        sourceLabel: 'invalid.example.com',
        sourceUrl: 'https://invalid.example.com/job',
        error: '暂时无法连接网页抓取服务，请稍后重试',
      },
    ],
  })
  const store = useOpportunityImportReviewStore()

  assert.doesNotThrow(() => store.open(payload))
  assert.equal(store.revision, 1)
  assert.equal(store.payload?.items.length, 2)
  assert.notEqual(store.payload, payload)
})
