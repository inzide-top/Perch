import assert from 'node:assert/strict'
import test from 'node:test'
import { toChatMessageParts } from './chat-message-mapper'

test('批量网址导入结果会持久化为可恢复的审核卡消息 Part', () => {
  const parts = toChatMessageParts('已完成岗位信息识别。', [
    {
      call: {
        type: 'tool_call',
        callId: 'call-import-urls',
        name: 'import_opportunities_from_urls',
        arguments: { urls: ['https://jobs.example.com/frontend', 'https://jobs.example.com/backend'] },
      },
      output: {
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
            sourceLabel: 'jobs.example.com',
            sourceUrl: 'https://jobs.example.com/backend',
            error: '网页没有可识别的岗位信息',
          },
        ],
      },
    },
  ])

  assert.equal(parts[0]?.type, 'text')
  assert.equal(parts[1]?.type, 'opportunity_import_result')
  if (parts[1]?.type !== 'opportunity_import_result') return
  assert.equal(parts[1].items.length, 2)
  assert.equal(parts[1].items[0]?.status, 'ready')
  assert.equal(parts[1].items[1]?.status, 'failed')
})

test('文本导入的部分字段预览也能生成审核卡', () => {
  const parts = toChatMessageParts('', [
    {
      call: {
        type: 'tool_call',
        callId: 'call-import-text',
        name: 'import_opportunity_from_text',
        arguments: { text: '岗位原文' },
      },
      output: {
        mode: 'text',
        items: [
          {
            status: 'ready',
            sourceLabel: '粘贴文本',
            sourceUrl: null,
            preview: {
              source: { type: 'text', label: '粘贴文本', url: null },
              sourceUrl: null,
              company: '',
              jobTitle: '前端工程师',
              address: [],
              introduction: '负责前端业务。',
              description: '熟悉 Vue。',
              missingRequiredFields: ['company'],
              warning: null,
            },
          },
        ],
      },
    },
  ])

  assert.equal(parts[0]?.type, 'opportunity_import_result')
  if (parts[0]?.type !== 'opportunity_import_result') return
  assert.deepEqual(parts[0].items[0]?.status === 'ready' && parts[0].items[0].preview.missingRequiredFields, [
    'company',
  ])
})
