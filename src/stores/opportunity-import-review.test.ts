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
        createdOpportunityId: null,
        createdAt: null,
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

  assert.doesNotThrow(() => store.open(payload, '00000000-0000-4000-8000-000000000001'))
  assert.equal(store.revision, 1)
  assert.equal(store.payload?.items.length, 2)
  assert.notEqual(store.payload, payload)

  store.markCreated('00000000-0000-4000-8000-000000000001', [
    { itemIndex: 0, opportunityId: '11111111-1111-4111-8111-111111111111' },
  ])
  const createdItem = store.payload?.items[0]
  assert.equal(
    createdItem?.status === 'ready' ? createdItem.createdOpportunityId : null,
    '11111111-1111-4111-8111-111111111111',
  )
})
