import assert from 'node:assert/strict'
import test from 'node:test'
import { toChatMessageParts } from './chat-message-mapper'

test('多个写工具卡片按执行顺序放在引导语和最终结果之间', () => {
  const parts = toChatMessageParts('我先帮你核对这两项修改。\n\n两项修改都已执行完成。', [], {
    toolActionIds: ['6ad676a2-0359-446a-b3d3-a1fc92d5f490', '8c23f521-df7d-4f26-8043-67730bb3b4f1'],
    leadingText: '我先帮你核对这两项修改。',
  })

  assert.deepEqual(parts, [
    { type: 'text', text: '我先帮你核对这两项修改。' },
    { type: 'tool_action', toolActionId: '6ad676a2-0359-446a-b3d3-a1fc92d5f490' },
    { type: 'tool_action', toolActionId: '8c23f521-df7d-4f26-8043-67730bb3b4f1' },
    { type: 'text', text: '\n\n两项修改都已执行完成。' },
  ])
})

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
