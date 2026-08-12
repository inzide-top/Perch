import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod'
import type { ChatRunStatus } from '@/shared/chat/schemas'
import type {
  AppendAssistantMessageRecord,
  AppendChatRunEventRecord,
  PersistWaitingInputRecord,
  PersistWaitingConfirmationRecord,
  UpdateChatRunRecord,
} from '../../repositories/chat.repository'
import { AgentToolRegistry } from './agent-tool'
import { toProviderMessages } from './chat-message-mapper'
import type { ModelProviderAdapter } from './model-provider-adapter'
import type { IndexChatMemoryInput, IndexChatMemoryResult } from '../retrieval/chat-memory-indexer'
import type { RetrieveChatMemoryInput } from '../retrieval/chat-memory-retriever'
import type { RetrievalResult } from '../retrieval/retrieval-types'

test('toProviderMessages 保留用户和助手文本，并忽略工具卡片', () => {
  const messages = toProviderMessages([
    { role: 'user', parts: [{ type: 'text', text: '帮我分析这个机会' }] },
    { role: 'assistant', parts: [{ type: 'tool_action', toolActionId: 'tool-1' }] },
    {
      role: 'assistant',
      parts: [
        { type: 'text', text: '我准备修改机会。' },
        { type: 'tool_action', toolActionId: 'tool-2' },
        { type: 'text', text: '\n\n已经修改完成。' },
      ],
    },
  ])

  assert.deepEqual(messages, [
    { role: 'user', content: '帮我分析这个机会' },
    { role: 'assistant', content: '我准备修改机会。\n\n已经修改完成。' },
  ])
})

test('toProviderMessages 用持久化工具状态区分真实修改和未完成操作', () => {
  const records = [
    {
      role: 'assistant' as const,
      parts: [
        { type: 'text', text: '已将意向等级改成 S。' },
        { type: 'tool_action', toolActionId: 'tool-completed' },
      ],
    },
    {
      role: 'assistant' as const,
      parts: [
        { type: 'text', text: '已关闭笔试流程。' },
        { type: 'tool_action', toolActionId: 'tool-cancelled' },
      ],
    },
  ]

  const messages = toProviderMessages(records, [
    { id: 'tool-completed', toolName: 'update_opportunity_profile', status: 'completed' },
    { id: 'tool-cancelled', toolName: 'update_opportunity_profile', status: 'cancelled' },
  ])

  assert.equal(messages[0]?.role, 'system')
  assert.match(messages[0]?.content ?? '', /已真实执行完成/)
  assert.match(messages[0]?.content ?? '', /不得在面向用户的回答中引用、复述或解释/)
  assert.deepEqual(messages[1], { role: 'assistant', content: '已将意向等级改成 S。' })
  assert.equal(messages[2]?.role, 'system')
  assert.match(messages[2]?.content ?? '', /不能据此认定数据库已经修改/)
  assert.deepEqual(messages[3], { role: 'assistant', content: '已关闭笔试流程。' })
})

test('toProviderMessages 清理旧版本误写进助手正文的内部工具状态', () => {
  const messages = toProviderMessages([
    {
      role: 'assistant',
      parts: [
        {
          type: 'text',
          text: '[系统执行记录：此历史回复关联的工具 create_mock_interview 未全部执行完成，不能据此认定数据库已经修改。]\n真正需要展示的回答。',
        },
      ],
    },
  ])

  assert.deepEqual(messages, [{ role: 'assistant', content: '真正需要展示的回答。' }])
})

class WorkerPersistence {
  revision = 1
  status: ChatRunStatus = 'queued'
  messages: AppendAssistantMessageRecord['message'][] = []

  async updateRun(input: UpdateChatRunRecord) {
    assert.equal(input.expectedRevision, this.revision)
    this.revision += 1
    if (input.patch.status) this.status = input.patch.status
    return { revision: this.revision }
  }

  async appendRunEvent(input: AppendChatRunEventRecord) {
    assert.equal(input.expectedRevision, this.revision)
    this.revision += 1
    return { run: { revision: this.revision }, event: input.event }
  }

  async appendAssistantMessage(input: AppendAssistantMessageRecord) {
    this.messages.push(input.message)
    return { id: input.message.id }
  }

  async persistWaitingConfirmation(_input: PersistWaitingConfirmationRecord): Promise<{
    run: { revision: number }
    toolAction: unknown
    event?: unknown
    duplicate: boolean
  }> {
    throw new Error('当前测试不应进入等待确认')
  }

  async persistWaitingInput(_input: PersistWaitingInputRecord): Promise<{
    run: { revision: number }
    toolAction: unknown
    event?: unknown
    duplicate: boolean
  }> {
    throw new Error('当前测试不应进入等待补充信息')
  }
}

class WaitingWorkerPersistence extends WorkerPersistence {
  override async persistWaitingConfirmation(input: PersistWaitingConfirmationRecord) {
    assert.equal(input.expectedRevision, this.revision)
    this.revision += 1
    this.status = 'waiting_confirmation'
    return {
      run: { revision: this.revision },
      toolAction: input.toolAction,
      duplicate: false,
    }
  }
}

function createMemoryIndexer(
  handler: (input: IndexChatMemoryInput) => IndexChatMemoryResult | Promise<IndexChatMemoryResult>,
) {
  return {
    async indexCompletedTurn(input: IndexChatMemoryInput) {
      return handler(input)
    },
  }
}

function createMemoryRetriever(
  handler: (input: RetrieveChatMemoryInput) => RetrievalResult[] | Promise<RetrievalResult[]>,
) {
  return {
    async retrieve(input: RetrieveChatMemoryInput) {
      return handler(input)
    },
  }
}

test('取消句柄只在 Worker 完成 cancelled 落库后结束', async () => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test'
  const { cancelChatRun, launchChatRunInBackground } = await import('./chat-worker')
  const persistence = new WorkerPersistence()
  let memoryIndexCount = 0
  const adapter: ModelProviderAdapter = {
    async *stream(input) {
      yield { type: 'text_delta', text: '部分回答' }
      await new Promise<void>((_resolve, reject) => {
        input.signal.addEventListener('abort', () => reject(new DOMException('已停止', 'AbortError')), { once: true })
      })
    },
  }
  const launchPromise = launchChatRunInBackground(
    {
      userId: 'user-1',
      conversationId: 'conversation-1',
      scopeType: 'global',
      runId: 'run-cancel-test',
      expectedRevision: 1,
      modelConnection: { baseUrl: 'https://example.com/v1', modelName: 'test-model', apiKey: 'test-key' },
      messages: [{ role: 'user', content: '测试停止' }],
      maxModelCalls: 2,
      maxToolCalls: 1,
      memoryIndex: { userText: '测试停止', relatedOpportunityIds: [] },
    },
    {
      persistence,
      adapter,
      toolRegistry: new AgentToolRegistry([
        {
          name: 'unused_tool',
          version: '1',
          description: '当前测试不会调用',
          inputSchema: { type: 'object' },
          inputValidator: z.object({}).strict(),
          requiresConfirmation: false,
          execute: async () => ({}),
        },
      ]),
      memoryIndexer: createMemoryIndexer(async () => {
        memoryIndexCount += 1
        return { status: 'indexed', documentCount: 1 }
      }),
      logError: () => undefined,
    },
  )

  await new Promise<void>((resolve) => setImmediate(resolve))
  const settled = cancelChatRun('run-cancel-test', '部分回答'.length)
  assert.ok(settled)
  await settled
  await launchPromise

  assert.equal(persistence.status, 'cancelled')
  assert.equal(persistence.messages.length, 1)
  assert.equal(persistence.messages[0]?.status, 'cancelled')
  assert.equal(memoryIndexCount, 0)
})

test('首轮回答完成后触发自动命名，命名失败也不会回滚已完成的 ChatRun', async () => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test'
  const { launchChatRunInBackground } = await import('./chat-worker')
  const persistence = new WorkerPersistence()
  const loggedStages: string[] = []
  let receivedAssistantText = ''
  const adapter: ModelProviderAdapter = {
    async *stream() {
      yield { type: 'text_delta', text: '建议优先准备 Vue 原理和工程化。' }
      yield { type: 'completed', finishReason: 'stop', tokenUsage: null }
    },
  }

  await launchChatRunInBackground(
    {
      userId: 'user-1',
      conversationId: 'conversation-1',
      scopeType: 'global',
      runId: 'run-auto-title-test',
      expectedRevision: 1,
      modelConnection: { baseUrl: 'https://example.com/v1', modelName: 'test-model', apiKey: 'test-key' },
      messages: [{ role: 'user', content: '我该怎么准备前端面试？' }],
      maxModelCalls: 2,
      maxToolCalls: 1,
      autoTitle: { expectedTitle: '我该怎么准备前端面试？', userText: '我该怎么准备前端面试？' },
    },
    {
      persistence,
      adapter,
      toolRegistry: new AgentToolRegistry([]),
      autoTitleHandler: async (input) => {
        receivedAssistantText = input.assistantText
        throw new Error('标题模型暂时不可用')
      },
      logError: (_error, context) => loggedStages.push(context.stage),
    },
  )

  assert.equal(persistence.status, 'completed')
  assert.equal(receivedAssistantText, '建议优先准备 Vue 原理和工程化。')
  assert.deepEqual(loggedStages, ['auto_title'])
})

test('主回答完成后才执行上下文压缩，压缩失败不回滚 ChatRun', async () => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test'
  const { launchChatRunInBackground } = await import('./chat-worker')
  const persistence = new WorkerPersistence()
  const loggedStages: string[] = []
  let compactionCount = 0
  const adapter: ModelProviderAdapter = {
    async *stream() {
      yield { type: 'text_delta', text: '主回答已经完成。' }
      yield { type: 'completed', finishReason: 'stop', tokenUsage: null }
    },
  }

  await launchChatRunInBackground(
    {
      userId: 'user-1',
      conversationId: 'conversation-1',
      scopeType: 'global',
      runId: 'run-context-compaction-test',
      expectedRevision: 1,
      modelConnection: { baseUrl: 'https://example.com/v1', modelName: 'test-model', apiKey: 'test-key' },
      messages: [{ role: 'user', content: '继续聊' }],
      maxModelCalls: 1,
      maxToolCalls: 0,
    },
    {
      persistence,
      adapter,
      toolRegistry: new AgentToolRegistry([]),
      contextCompactor: async () => {
        compactionCount += 1
        assert.equal(persistence.status, 'completed')
        throw new Error('摘要服务暂时不可用')
      },
      logError: (_error, context) => loggedStages.push(context.stage),
    },
  )

  assert.equal(compactionCount, 1)
  assert.equal(persistence.status, 'completed')
  assert.deepEqual(loggedStages, ['context_compaction'])
})

test('回答完成后才建立记忆索引，并合并显式引用与可信工具参数中的机会 ID', async () => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test'
  const { launchChatRunInBackground } = await import('./chat-worker')
  const persistence = new WorkerPersistence()
  const referencedOpportunityId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const toolOpportunityId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  let modelCall = 0
  const memoryInputs: IndexChatMemoryInput[] = []
  const adapter: ModelProviderAdapter = {
    async *stream() {
      modelCall += 1
      if (modelCall === 1) {
        yield { type: 'text_delta', text: '我先读取这两个机会。' }
        yield {
          type: 'tool_call',
          callId: 'tool-call-1',
          name: 'read_opportunity',
          arguments: { opportunityId: toolOpportunityId },
        }
        yield { type: 'completed', finishReason: 'tool_call', tokenUsage: null }
        return
      }
      yield { type: 'text_delta', text: '这两个机会都匹配你的前端经历，但第二个更看重工程化。' }
      yield { type: 'completed', finishReason: 'stop', tokenUsage: null }
    },
  }

  await launchChatRunInBackground(
    {
      userId: 'user-1',
      conversationId: 'conversation-1',
      scopeType: 'global',
      runId: 'run-memory-index-test',
      expectedRevision: 1,
      modelConnection: { baseUrl: 'https://example.com/v1', modelName: 'test-model', apiKey: 'test-key' },
      messages: [{ role: 'user', content: '帮我比较这两个机会' }],
      maxModelCalls: 2,
      maxToolCalls: 1,
      memoryIndex: {
        userText: '帮我比较这两个机会',
        relatedOpportunityIds: [referencedOpportunityId],
      },
    },
    {
      persistence,
      adapter,
      toolRegistry: new AgentToolRegistry([
        {
          name: 'read_opportunity',
          version: '1',
          description: '读取一个机会',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['opportunityId'],
            properties: { opportunityId: { type: 'string', format: 'uuid' } },
          },
          inputValidator: z.object({ opportunityId: z.string().uuid() }).strict(),
          requiresConfirmation: false,
          execute: async (input) => ({ opportunityId: input.opportunityId }),
        },
      ]),
      memoryIndexer: createMemoryIndexer(async (input) => {
        assert.equal(persistence.status, 'completed')
        memoryInputs.push(input)
        return { status: 'indexed', documentCount: 1 }
      }),
      logError: () => undefined,
    },
  )

  const memoryInput = memoryInputs[0]
  assert.ok(memoryInput)
  assert.equal(memoryInput.userText, '帮我比较这两个机会')
  assert.equal(
    memoryInput.assistantText,
    '我先读取这两个机会。\n\n这两个机会都匹配你的前端经历，但第二个更看重工程化。',
  )
  assert.deepEqual(memoryInput.relatedOpportunityIds, [referencedOpportunityId, toolOpportunityId])
})

test('首次模型调用前按当前对话边界召回历史记忆并合并进 System Message', async () => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test'
  const { launchChatRunInBackground } = await import('./chat-worker')
  const persistence = new WorkerPersistence()
  const referencedOpportunityId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const retrievalInputs: RetrieveChatMemoryInput[] = []
  let receivedMessages: Parameters<NonNullable<ModelProviderAdapter['stream']>>[0]['messages'] = []
  const adapter: ModelProviderAdapter = {
    async *stream(input) {
      receivedMessages = input.messages
      yield { type: 'text_delta', text: '建议重点复习 Vue 依赖收集。' }
      yield { type: 'completed', finishReason: 'stop', tokenUsage: null }
    },
  }

  await launchChatRunInBackground(
    {
      userId: 'user-1',
      conversationId: 'conversation-1',
      scopeType: 'opportunity',
      opportunity: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } as never,
      runId: 'run-memory-retrieval-test',
      expectedRevision: 1,
      modelConnection: { baseUrl: 'https://example.com/v1', modelName: 'test-model', apiKey: 'test-key' },
      messages: [
        { role: 'system', content: '你是 PERCH。' },
        { role: 'user', content: '我之前 Vue 哪里掌握得不好？' },
      ],
      maxModelCalls: 1,
      maxToolCalls: 0,
      memoryIndex: {
        userText: '我之前 Vue 哪里掌握得不好？',
        relatedOpportunityIds: [referencedOpportunityId],
      },
    },
    {
      persistence,
      adapter,
      toolRegistry: new AgentToolRegistry([]),
      memoryRetriever: createMemoryRetriever(async (input) => {
        retrievalInputs.push(input)
        return [
          {
            documentId: 'document-1',
            conversationId: 'old-conversation',
            runId: 'old-run',
            content: '用户以前对 Vue 依赖收集的解释不完整。',
            score: 0.88,
            scope: { type: 'global' },
          },
        ]
      }),
      memoryIndexer: null,
      logError: () => undefined,
    },
  )

  assert.equal(retrievalInputs.length, 1)
  assert.deepEqual(retrievalInputs[0]?.scope, {
    userId: 'user-1',
    currentConversationId: 'conversation-1',
    conversationScopeType: 'opportunity',
    boundOpportunityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    referencedOpportunityIds: [referencedOpportunityId],
  })
  assert.equal(receivedMessages[0]?.role, 'system')
  assert.match(receivedMessages[0]?.content ?? '', /Vue 依赖收集的解释不完整/)
  assert.equal(persistence.status, 'completed')
})

test('历史记忆召回失败时继续正常模型回答并只记录旁路错误', async () => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test'
  const { launchChatRunInBackground } = await import('./chat-worker')
  const persistence = new WorkerPersistence()
  const loggedStages: string[] = []
  const adapter: ModelProviderAdapter = {
    async *stream(input) {
      assert.deepEqual(input.messages, [{ role: 'user', content: '继续准备面试' }])
      yield { type: 'text_delta', text: '我们继续准备。' }
      yield { type: 'completed', finishReason: 'stop', tokenUsage: null }
    },
  }

  await launchChatRunInBackground(
    {
      userId: 'user-1',
      conversationId: 'conversation-1',
      scopeType: 'global',
      runId: 'run-memory-retrieval-failed-test',
      expectedRevision: 1,
      modelConnection: { baseUrl: 'https://example.com/v1', modelName: 'test-model', apiKey: 'test-key' },
      messages: [{ role: 'user', content: '继续准备面试' }],
      maxModelCalls: 1,
      maxToolCalls: 0,
      memoryIndex: { userText: '继续准备面试', relatedOpportunityIds: [] },
    },
    {
      persistence,
      adapter,
      toolRegistry: new AgentToolRegistry([]),
      memoryRetriever: createMemoryRetriever(async () => {
        throw new Error('Embedding provider unavailable')
      }),
      memoryIndexer: null,
      logError: (_error, context) => loggedStages.push(context.stage),
    },
  )

  assert.equal(persistence.status, 'completed')
  assert.deepEqual(loggedStages, ['memory_retrieval'])
})

test('完全匹配确认词时跳过历史记忆检索但仍正常完成回答', async () => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test'
  const { launchChatRunInBackground } = await import('./chat-worker')
  const persistence = new WorkerPersistence()
  let retrievalCount = 0
  const adapter: ModelProviderAdapter = {
    async *stream(input) {
      assert.deepEqual(input.messages, [{ role: 'user', content: '好的。' }])
      yield { type: 'text_delta', text: '好的，我们继续。' }
      yield { type: 'completed', finishReason: 'stop', tokenUsage: null }
    },
  }

  await launchChatRunInBackground(
    {
      userId: 'user-1',
      conversationId: 'conversation-1',
      scopeType: 'global',
      runId: 'run-memory-retrieval-acknowledgement-test',
      expectedRevision: 1,
      modelConnection: { baseUrl: 'https://example.com/v1', modelName: 'test-model', apiKey: 'test-key' },
      messages: [{ role: 'user', content: '好的。' }],
      maxModelCalls: 1,
      maxToolCalls: 0,
      memoryIndex: { userText: '好的。', relatedOpportunityIds: [] },
    },
    {
      persistence,
      adapter,
      toolRegistry: new AgentToolRegistry([]),
      memoryRetriever: createMemoryRetriever(async () => {
        retrievalCount += 1
        return []
      }),
      memoryIndexer: null,
      logError: () => undefined,
    },
  )

  assert.equal(retrievalCount, 0)
  assert.equal(persistence.status, 'completed')
})

test('等待用户确认时不会提前建立记忆索引', async () => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test'
  const { launchChatRunInBackground } = await import('./chat-worker')
  const persistence = new WaitingWorkerPersistence()
  let memoryIndexCount = 0
  const adapter: ModelProviderAdapter = {
    async *stream() {
      yield {
        type: 'tool_call',
        callId: 'tool-call-confirmation',
        name: 'update_opportunity',
        arguments: { intentionLevel: 'S' },
      }
      yield { type: 'completed', finishReason: 'tool_call', tokenUsage: null }
    },
  }

  await launchChatRunInBackground(
    {
      userId: 'user-1',
      conversationId: 'conversation-1',
      scopeType: 'global',
      runId: 'run-waiting-confirmation-test',
      expectedRevision: 1,
      modelConnection: { baseUrl: 'https://example.com/v1', modelName: 'test-model', apiKey: 'test-key' },
      messages: [{ role: 'user', content: '把意向改成 S' }],
      maxModelCalls: 2,
      maxToolCalls: 1,
      memoryIndex: { userText: '把意向改成 S', relatedOpportunityIds: [] },
    },
    {
      persistence,
      adapter,
      toolRegistry: new AgentToolRegistry([
        {
          name: 'update_opportunity',
          version: '1',
          description: '修改机会',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['intentionLevel'],
            properties: { intentionLevel: { type: 'string', enum: ['S'] } },
          },
          inputValidator: z.object({ intentionLevel: z.literal('S') }).strict(),
          requiresConfirmation: true,
          execute: async () => ({ updated: true }),
        },
      ]),
      memoryIndexer: createMemoryIndexer(async () => {
        memoryIndexCount += 1
        return { status: 'indexed', documentCount: 1 }
      }),
      logError: () => undefined,
    },
  )

  assert.equal(persistence.status, 'waiting_confirmation')
  assert.equal(memoryIndexCount, 0)
})

test('记忆索引失败只记录旁路错误，不回滚已经完成的主回答', async () => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test'
  const { launchChatRunInBackground } = await import('./chat-worker')
  const persistence = new WorkerPersistence()
  const loggedStages: string[] = []
  const adapter: ModelProviderAdapter = {
    async *stream() {
      yield { type: 'text_delta', text: '建议先复习 Vue 响应式原理。' }
      yield { type: 'completed', finishReason: 'stop', tokenUsage: null }
    },
  }

  await launchChatRunInBackground(
    {
      userId: 'user-1',
      conversationId: 'conversation-1',
      scopeType: 'global',
      runId: 'run-memory-index-failed-test',
      expectedRevision: 1,
      modelConnection: { baseUrl: 'https://example.com/v1', modelName: 'test-model', apiKey: 'test-key' },
      messages: [{ role: 'user', content: '我该复习什么？' }],
      maxModelCalls: 1,
      maxToolCalls: 0,
      memoryIndex: { userText: '我该复习什么？', relatedOpportunityIds: [] },
    },
    {
      persistence,
      adapter,
      toolRegistry: new AgentToolRegistry([]),
      memoryIndexer: createMemoryIndexer(async () => {
        throw new Error('Embedding 服务暂时不可用')
      }),
      logError: (_error, context) => loggedStages.push(context.stage),
    },
  )

  assert.equal(persistence.status, 'completed')
  assert.equal(persistence.messages[0]?.status, 'completed')
  assert.deepEqual(loggedStages, ['memory_index'])
})
