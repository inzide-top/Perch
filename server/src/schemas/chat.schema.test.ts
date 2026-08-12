import assert from 'node:assert/strict'
import test from 'node:test'
import { agentWorkflowTypeSchema } from '@/shared/interview/schemas'
import {
  chatMessagePartSchema,
  chatModelSnapshotSchema,
  chatRunBudgetSchema,
  chatRunEventTypeSchema,
  chatToolInputPresentationSchema,
} from '@/shared/chat/schemas'
import {
  chatRunEventsQuerySchema,
  createChatCommandInputSchema,
  createChatConversationInputSchema,
  listChatConversationsQuerySchema,
  sendChatMessageInputSchema,
  updateChatConversationInputSchema,
} from './chat.schema'

test('聊天消息 Parts 使用 type 区分文本、工具动作、结果卡片和产物', () => {
  const toolActionId = '00000000-0000-4000-8000-000000000001'
  const artifactId = '00000000-0000-4000-8000-000000000002'

  assert.deepEqual(chatMessagePartSchema.parse({ type: 'text', text: '先分析这个 JD' }), {
    type: 'text',
    text: '先分析这个 JD',
  })
  assert.deepEqual(chatMessagePartSchema.parse({ type: 'tool_action', toolActionId }), {
    type: 'tool_action',
    toolActionId,
  })
  assert.deepEqual(chatMessagePartSchema.parse({ type: 'artifact', artifactId }), {
    type: 'artifact',
    artifactId,
  })
  assert.equal(
    chatMessagePartSchema.parse({
      type: 'opportunity_search_result',
      query: { statuses: ['interviewing'], intentionLevels: [] },
      matchedCount: 1,
      returnedCount: 1,
      hasMore: false,
      items: [
        {
          opportunityId: '00000000-0000-4000-8000-000000000003',
          company: '小米',
          jobTitle: '前端工程师',
          status: 'interviewing',
          statusLabel: '面试中',
          intentionLevel: 'S',
          industry: '互联网',
          address: ['上海'],
          updatedAt: '2026-08-08T00:00:00.000Z',
        },
      ],
    }).type,
    'opportunity_search_result',
  )
  assert.throws(() => chatMessagePartSchema.parse({ type: 'tool_action', artifactId }))
})

test('聊天 Run 的模型快照、预算和事件类型在运行时有边界', () => {
  assert.deepEqual(chatModelSnapshotSchema.parse({ modelName: 'deepseek-chat', baseUrl: 'https://api.deepseek.com' }), {
    modelName: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com',
  })
  assert.deepEqual(chatRunBudgetSchema.parse({ maxModelCalls: 4, maxToolCalls: 3 }), {
    maxModelCalls: 4,
    maxToolCalls: 3,
  })
  assert.equal(chatRunEventTypeSchema.parse('message_delta'), 'message_delta')
  assert.throws(() => chatRunBudgetSchema.parse({ maxModelCalls: 0, maxToolCalls: 3 }))
  assert.throws(() => chatRunEventTypeSchema.parse('token'))
})

test('等待输入协议支持能力画像的简历选择卡并拒绝伪造字段', () => {
  const parsed = chatToolInputPresentationSchema.parse({
    kind: 'resume_target_input',
    title: '选择能力画像使用的简历',
    reason: 'missing_reference',
    reference: null,
    candidates: [
      {
        resumeId: '00000000-0000-4000-8000-000000000201',
        title: '前端开发主线',
        updatedAt: '2026-08-08T00:00:00.000Z',
      },
    ],
  })

  assert.equal(parsed.kind, 'resume_target_input')
  assert.equal(
    chatToolInputPresentationSchema.safeParse({
      ...parsed,
      candidates: [{ ...parsed.candidates[0], userId: 'forged-user' }],
    }).success,
    false,
  )
})

test('AgentRun 工作流类型包含 chat_turn', () => {
  assert.equal(agentWorkflowTypeSchema.parse('chat_turn'), 'chat_turn')
})

test('聊天会话 Schema 强制全局与岗位范围的绑定关系', () => {
  const opportunityId = '00000000-0000-4000-8000-000000000003'
  assert.deepEqual(createChatConversationInputSchema.parse({ title: '全局规划', scopeType: 'global' }), {
    title: '全局规划',
    scopeType: 'global',
    opportunityId: null,
  })
  assert.equal(
    createChatConversationInputSchema.safeParse({
      title: '错误范围',
      scopeType: 'global',
      opportunityId,
    }).success,
    false,
  )
  assert.equal(
    createChatConversationInputSchema.safeParse({ title: '缺少岗位', scopeType: 'opportunity' }).success,
    false,
  )
})

test('聊天会话更新只允许重命名或切换归档状态，且不能提交空更新', () => {
  assert.deepEqual(updateChatConversationInputSchema.parse({ title: '新的标题' }), { title: '新的标题' })
  assert.deepEqual(updateChatConversationInputSchema.parse({ archived: true }), { archived: true })
  assert.equal(updateChatConversationInputSchema.safeParse({}).success, false)
  assert.equal(updateChatConversationInputSchema.safeParse({ title: '   ' }).success, false)
  assert.equal(updateChatConversationInputSchema.safeParse({ title: '标题', extra: true }).success, false)
})

test('聊天历史列表支持后端筛选、分页游标并限制不合法范围组合', () => {
  const opportunityId = '00000000-0000-4000-8000-000000000003'
  const cursor = Buffer.from(
    JSON.stringify({
      updatedAt: '2026-08-08T12:00:00.000Z',
      id: '00000000-0000-4000-8000-000000000010',
    }),
  ).toString('base64url')

  assert.deepEqual(listChatConversationsQuerySchema.parse({}), {
    limit: 20,
    archived: 'active',
  })
  assert.deepEqual(
    listChatConversationsQuerySchema.parse({
      cursor,
      limit: '10',
      search: '  Vue 面试  ',
      scopeType: 'opportunity',
      opportunityId,
      archived: 'all',
    }),
    {
      cursor: {
        updatedAt: '2026-08-08T12:00:00.000Z',
        id: '00000000-0000-4000-8000-000000000010',
      },
      limit: 10,
      search: 'Vue 面试',
      scopeType: 'opportunity',
      opportunityId,
      archived: 'all',
    },
  )
  assert.equal(listChatConversationsQuerySchema.parse({ archived: 'archived' }).archived, 'archived')
  assert.equal(listChatConversationsQuerySchema.safeParse({ cursor: 'not-a-cursor' }).success, false)
  assert.equal(listChatConversationsQuerySchema.safeParse({ scopeType: 'global', opportunityId }).success, false)
})

test('聊天请求 Schema 默认预算并拒绝把 API Key 放进模型快照字段', () => {
  const parsed = sendChatMessageInputSchema.parse({
    commandId: '00000000-0000-4000-8000-000000000006',
    text: '准备一轮项目面试',
    modelConnection: {
      baseUrl: 'https://api.example.com',
      modelName: 'example-chat',
      apiKey: 'secret',
    },
  })
  assert.deepEqual(parsed.budget, { maxModelCalls: 4, maxToolCalls: 8 })
  assert.deepEqual(parsed.references, [])
  assert.equal(parsed.promptVersion, 'chat.v1')
  assert.equal(
    sendChatMessageInputSchema.safeParse({
      commandId: '00000000-0000-4000-8000-000000000006',
      text: 'test',
      modelConnection: {
        baseUrl: 'https://api.example.com',
        modelName: 'example-chat',
        apiKey: 'secret',
        modelSnapshot: { apiKey: 'secret' },
      },
    }).success,
    false,
  )
})

test('聊天消息支持一次性引用结构化上下文且限制引用数量', () => {
  const parsed = sendChatMessageInputSchema.parse({
    commandId: '00000000-0000-4000-8000-000000000007',
    text: '对比我明确选择的岗位',
    references: [
      {
        type: 'opportunity',
        id: '00000000-0000-4000-8000-000000000005',
      },
    ],
    modelConnection: {
      baseUrl: 'https://api.example.com',
      modelName: 'example-chat',
      apiKey: 'secret',
    },
  })

  assert.equal(parsed.references[0]?.type, 'opportunity')
  assert.equal(
    sendChatMessageInputSchema.safeParse({
      commandId: '00000000-0000-4000-8000-000000000008',
      text: '引用过多',
      references: Array.from({ length: 6 }, (_, index) => ({
        type: 'opportunity',
        id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
      })),
      modelConnection: {
        baseUrl: 'https://api.example.com',
        modelName: 'example-chat',
        apiKey: 'secret',
      },
    }).success,
    false,
  )
  assert.equal(
    sendChatMessageInputSchema.safeParse({
      commandId: '00000000-0000-4000-8000-000000000009',
      text: '客户端不能伪造引用标签',
      references: [
        {
          type: 'opportunity',
          id: '00000000-0000-4000-8000-000000000005',
          label: '伪造公司 · 伪造岗位',
        },
      ],
      modelConnection: {
        baseUrl: 'https://api.example.com',
        modelName: 'example-chat',
        apiKey: 'secret',
      },
    }).success,
    false,
  )
  assert.equal(
    sendChatMessageInputSchema.safeParse({
      commandId: '00000000-0000-4000-8000-000000000010',
      text: '同一个机会不能重复引用',
      references: [
        { type: 'opportunity', id: '00000000-0000-4000-8000-000000000005' },
        { type: 'opportunity', id: '00000000-0000-4000-8000-000000000005' },
      ],
      modelConnection: {
        baseUrl: 'https://api.example.com',
        modelName: 'example-chat',
        apiKey: 'secret',
      },
    }).success,
    false,
  )
})

test('聊天事件游标和 Command 请求只接受受控范围', () => {
  assert.deepEqual(chatRunEventsQuerySchema.parse({}), { afterSequence: 0, limit: 200 })
  assert.equal(
    createChatCommandInputSchema.safeParse({
      commandId: '00000000-0000-4000-8000-000000000004',
      type: 'cancel_run',
      expectedRevision: 2,
      payload: { reason: 'user_cancelled', visibleTextLength: 128 },
    }).success,
    true,
  )
  assert.equal(
    createChatCommandInputSchema.safeParse({
      commandId: '00000000-0000-4000-8000-000000000005',
      type: 'provide_input',
      expectedRevision: 3,
      payload: {
        requestId: '00000000-0000-4000-8000-000000000010',
        value: { type: 'project', scheduledAt: '2099-08-12T19:00:00+08:00' },
      },
      modelConnection: {
        baseUrl: 'https://api.example.com',
        modelName: 'example-chat',
        apiKey: 'request-memory-only',
      },
    }).success,
    true,
  )
  assert.equal(
    createChatCommandInputSchema.safeParse({
      commandId: '00000000-0000-4000-8000-000000000006',
      type: 'provide_input',
      expectedRevision: 3,
      payload: { requestId: '00000000-0000-4000-8000-000000000010', value: {} },
    }).success,
    false,
  )
  assert.equal(
    createChatCommandInputSchema.safeParse({
      commandId: '00000000-0000-4000-8000-000000000004',
      type: 'confirm_tool',
      expectedRevision: 2,
      payload: {
        toolActionId: '00000000-0000-4000-8000-000000000009',
        decision: 'approved',
        apiKey: 'must-not-be-persisted',
      },
    }).success,
    false,
  )
  assert.equal(
    createChatCommandInputSchema.safeParse({
      commandId: '00000000-0000-4000-8000-000000000004',
      type: 'confirm_tool',
      expectedRevision: 2,
      payload: {
        toolActionId: '00000000-0000-4000-8000-000000000009',
        decision: 'approved',
      },
      modelConnection: {
        baseUrl: 'https://api.example.com',
        modelName: 'example-chat',
        apiKey: 'request-memory-only',
      },
    }).success,
    true,
  )
  assert.equal(
    createChatCommandInputSchema.safeParse({
      commandId: '00000000-0000-4000-8000-000000000004',
      type: 'cancel_run',
      expectedRevision: -1,
    }).success,
    false,
  )
  assert.equal(
    createChatCommandInputSchema.safeParse({
      commandId: '00000000-0000-4000-8000-000000000004',
      type: 'cancel_run',
      expectedRevision: 2,
      payload: { visibleTextLength: -1 },
    }).success,
    false,
  )
})
