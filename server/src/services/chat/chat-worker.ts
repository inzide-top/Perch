import { chatRepository } from '../../repositories/chat.repository'
import { agentRunRepository } from '../../repositories/agent-run.repository'
import { opportunityRepository, type JobOpportunityRecord } from '../../repositories/opportunity.repository'
import { resumeRepository } from '../../repositories/resume.repository'
import type { ModelConnection } from '../../schemas/model.schema'
import { AgentToolRegistry } from './agent-tool'
import { executeChatRun, type ChatRunContinuation, type ChatRunPersistence } from './chat-runner'
import { createChatToolRegistry } from './chat-tools'
import { OpenAICompatibleAdapter } from './openai-compatible-adapter'
import type { ModelProviderAdapter, ModelProviderMessage } from './model-provider-adapter'
import type { ChatConversationScopeType } from '@/shared/chat/schemas'
import {
  batchUpdateOpportunityProfilesForUser,
  createInterviewScheduleForUser,
  terminateOpportunityForUser,
  transitionOpportunityStatusForUser,
  updateInterviewReviewForUser,
  updateOpportunityProfileForUser,
  updateWrittenTestReviewForUser,
} from '../opportunity.service'
import { createInterviewSessionForUser } from '../interview.service'
import { getCapabilityProfileForUser } from '../capability-profile.service'
import { getActionStrategyOverviewForUser } from '../action-strategy.service'
import { generateChatConversationTitle, type ChatConversationAutoTitleRequest } from './chat-title'
import { getOpportunityContextForUser } from './opportunity-context'
import { importJobOpportunitiesFromUrls, importJobOpportunityFromText } from '../opportunity-import.service'
import { ChatMemoryIndexer, type IndexChatMemoryInput } from '../retrieval/chat-memory-indexer'
import { getConfiguredChatMemoryIndexer, getConfiguredChatMemoryRetriever } from '../retrieval/chat-memory-environment'
import { collectChatMemoryOpportunityIds } from '../retrieval/chat-memory-opportunity-ids'
import { appendChatMemoryContext } from '../retrieval/chat-memory-context'
import type { ChatMemoryRetriever } from '../retrieval/chat-memory-retriever'
import { shouldRetrieveChatMemory } from '../retrieval/chat-memory-retrieval-policy'
import type { AgentToolResult } from './agent-runtime'
import type { AgentModelCallObserver } from './agent-runtime'
import { createChatModelAgentRunObserver } from './chat-model-agent-run'
import { compactCompletedChatConversation } from './chat-context-compactor'

type ActiveChatRun = {
  controller: AbortController
  visibleTextLength: number | null
  settled: Promise<void>
  resolveSettled: () => void
}

const activeChatRuns = new Map<string, ActiveChatRun>()

/**
 * 取消当前进程内正在执行的模型请求。
 * 数据库中的最终 cancelled 状态仍由 ChatRun 执行器写入，避免 API 层和 Worker 同时改状态。
 */
export function cancelChatRun(runId: string, visibleTextLength?: number) {
  const activeRun = activeChatRuns.get(runId)
  if (!activeRun) return null

  activeRun.visibleTextLength = visibleTextLength ?? null
  activeRun.controller.abort('user_requested')
  return activeRun.settled
}

export type LaunchChatRunInput = {
  userId: string
  conversationId: string
  scopeType: ChatConversationScopeType
  opportunity?: JobOpportunityRecord | null
  runId: string
  expectedRevision: number
  modelConnection: ModelConnection
  promptVersion?: string
  messages: ModelProviderMessage[]
  maxModelCalls: number
  maxToolCalls: number
  continuation?: ChatRunContinuation
  autoTitle?: ChatConversationAutoTitleRequest
  memoryIndex?: ChatMemoryIndexContext
}

export type ChatMemoryIndexContext = {
  userText: string
  relatedOpportunityIds: string[]
}

type ChatAutoTitleHandlerInput = ChatConversationAutoTitleRequest & {
  userId: string
  conversationId: string
  assistantText: string
  modelConnection: ModelConnection
  adapter: ModelProviderAdapter
  signal: AbortSignal
}

export type ChatWorkerDependencies = {
  persistence?: ChatRunPersistence
  adapter?: ModelProviderAdapter
  toolRegistry?: AgentToolRegistry
  autoTitleHandler?: (input: ChatAutoTitleHandlerInput) => Promise<void>
  memoryIndexer?: Pick<ChatMemoryIndexer, 'indexCompletedTurn'> | null
  memoryRetriever?: Pick<ChatMemoryRetriever, 'retrieve'> | null
  modelCallObserver?: AgentModelCallObserver | null
  contextCompactor?:
    | ((input: {
        userId: string
        conversationId: string
        modelConnection: ModelConnection
        adapter: ModelProviderAdapter
        signal: AbortSignal
      }) => Promise<unknown>)
    | null
  logError?: (
    error: unknown,
    context: {
      runId: string
      stage: 'run' | 'auto_title' | 'memory_index' | 'memory_retrieval' | 'context_compaction' | 'model_call_recording'
    },
  ) => void
}

function collectRelatedOpportunityIds(input: LaunchChatRunInput, toolResults: AgentToolResult[]) {
  return collectChatMemoryOpportunityIds(
    [
      ...toolResults.map((result) => result.call.arguments),
      ...(input.continuation ? [input.continuation.checkpoint.pendingCall.arguments] : []),
    ],
    input.memoryIndex?.relatedOpportunityIds ?? [],
  )
}

async function generateAndPersistConversationTitle(input: ChatAutoTitleHandlerInput) {
  // 先检查一次，避免用户已经手动改名后仍产生不必要的模型费用。
  const conversation = await chatRepository.findConversationById(input.conversationId, input.userId)
  if (!conversation || conversation.title !== input.expectedTitle) return

  const title = await generateChatConversationTitle(
    {
      modelConnection: input.modelConnection,
      userText: input.userText,
      assistantText: input.assistantText,
      signal: input.signal,
    },
    input.adapter,
  )

  // 模型调用期间用户仍可能手动改名，因此最终写入再次使用旧标题做条件更新。
  await chatRepository.updateConversationTitleIfUnchanged({
    id: input.conversationId,
    userId: input.userId,
    expectedTitle: input.expectedTitle,
    title,
    updatedAt: new Date().toISOString(),
  })
}

/**
 * 第一版轻量 Worker：在 API 进程内异步执行 queued Run。
 * API Key 只从请求传入到本次内存任务，不写入数据库。
 */
export async function launchChatRunInBackground(input: LaunchChatRunInput, dependencies: ChatWorkerDependencies = {}) {
  const persistence = dependencies.persistence ?? chatRepository
  const adapter = dependencies.adapter ?? new OpenAICompatibleAdapter()
  const toolRegistry =
    dependencies.toolRegistry ??
    createChatToolRegistry(
      { userId: input.userId, scopeType: input.scopeType, opportunity: input.opportunity ?? null },
      {
        findOpportunitiesByUserId: opportunityRepository.findOpportunitiesByUserId.bind(opportunityRepository),
        findResumesByUserId: resumeRepository.findResumesByUserId.bind(resumeRepository),
        getOpportunityContextForUser,
        getCapabilityProfileForUser,
        getActionStrategyOverviewForUser,
        importOpportunitiesFromUrls: ({ urls, signal }) => importJobOpportunitiesFromUrls({ urls }, { signal }),
        importOpportunityFromText: ({ text, signal }) =>
          importJobOpportunityFromText({ text, modelConnection: input.modelConnection }, { signal }),
        updateOpportunityProfileForUser,
        batchUpdateOpportunityProfilesForUser,
        transitionOpportunityStatusForUser,
        terminateOpportunityForUser,
        createInterviewScheduleForUser,
        createMockInterviewForUser: (record) =>
          createInterviewSessionForUser({
            ...record,
            input: {
              configuration: record.configuration,
              modelConnection: input.modelConnection,
            },
          }),
        saveWrittenTestReviewForUser: (record) =>
          updateWrittenTestReviewForUser({ ...record, modelConnection: input.modelConnection }),
        findInterviewRoundsByOpportunityId:
          opportunityRepository.findInterviewRoundsByOpportunityId.bind(opportunityRepository),
        saveInterviewReviewForUser: (record) =>
          updateInterviewReviewForUser({ ...record, modelConnection: input.modelConnection }),
      },
    )
  const controller = new AbortController()
  let resolveSettled: () => void = () => undefined
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve
  })
  const activeRun: ActiveChatRun = { controller, visibleTextLength: null, settled, resolveSettled }
  activeChatRuns.set(input.runId, activeRun)
  const logError =
    dependencies.logError ??
    ((
      backgroundError: unknown,
      context: {
        runId: string
        stage:
          'run' | 'auto_title' | 'memory_index' | 'memory_retrieval' | 'context_compaction' | 'model_call_recording'
      },
    ) => {
      console.error('ChatRun 后台任务失败', context, backgroundError)
    })
  const modelCallObserver =
    dependencies.modelCallObserver === undefined
      ? persistence === chatRepository
        ? createChatModelAgentRunObserver(
            {
              chatRunId: input.runId,
              modelName: input.modelConnection.modelName,
              promptVersion: input.promptVersion ?? 'chat.v1',
            },
            {
              persistence: agentRunRepository,
              onError: (error) =>
                logError(error, {
                  runId: input.runId,
                  stage: 'model_call_recording',
                }),
            },
          )
        : undefined
      : (dependencies.modelCallObserver ?? undefined)

  try {
    let runMessages = input.messages
    if (
      input.memoryIndex &&
      shouldRetrieveChatMemory({ userText: input.memoryIndex.userText, isContinuation: Boolean(input.continuation) })
    ) {
      try {
        const memoryRetriever =
          dependencies.memoryRetriever === undefined ? getConfiguredChatMemoryRetriever() : dependencies.memoryRetriever
        const memories = await memoryRetriever?.retrieve({
          queryText: input.memoryIndex.userText,
          scope: {
            userId: input.userId,
            currentConversationId: input.conversationId,
            conversationScopeType: input.scopeType,
            boundOpportunityId: input.opportunity?.id ?? null,
            referencedOpportunityIds: input.memoryIndex.relatedOpportunityIds,
          },
          signal: controller.signal,
        })
        if (memories?.length) runMessages = appendChatMemoryContext(runMessages, memories)
      } catch (error) {
        // 历史召回是旁路增强，失败时继续使用原始消息；用户停止产生的 Abort 不需要额外报错。
        if (!controller.signal.aborted) logError(error, { runId: input.runId, stage: 'memory_retrieval' })
      }
    }

    const result = await executeChatRun(
      {
        userId: input.userId,
        conversationId: input.conversationId,
        runId: input.runId,
        expectedRevision: input.expectedRevision,
        modelConnection: input.modelConnection,
        messages: runMessages,
        toolRegistry,
        signal: controller.signal,
        getCancellationVisibleTextLength: () => activeRun.visibleTextLength,
        maxModelCalls: input.maxModelCalls,
        maxToolCalls: input.maxToolCalls,
        continuation: input.continuation,
        modelCallObserver,
      },
      { adapter, persistence },
    )
    if (result.status === 'completed' && input.autoTitle) {
      try {
        await (dependencies.autoTitleHandler ?? generateAndPersistConversationTitle)({
          ...input.autoTitle,
          userId: input.userId,
          conversationId: input.conversationId,
          assistantText: result.text,
          modelConnection: input.modelConnection,
          adapter,
          signal: controller.signal,
        })
      } catch (error) {
        // 自动标题是旁路增强，失败不能把已经完成的主回答改成 failed。
        logError(error, { runId: input.runId, stage: 'auto_title' })
      }
    }
    if (result.status === 'completed' && input.memoryIndex) {
      try {
        const memoryIndexer =
          dependencies.memoryIndexer === undefined ? getConfiguredChatMemoryIndexer() : dependencies.memoryIndexer
        await memoryIndexer?.indexCompletedTurn({
          userId: input.userId,
          conversationId: input.conversationId,
          runId: input.runId,
          userText: input.memoryIndex.userText,
          assistantText: result.text,
          boundOpportunityId: input.opportunity?.id ?? null,
          relatedOpportunityIds: collectRelatedOpportunityIds(input, result.toolResults),
          signal: controller.signal,
        } satisfies IndexChatMemoryInput)
      } catch (error) {
        // 历史记忆是旁路增强；索引失败不能把已经完成并展示的主回答改成 failed。
        logError(error, { runId: input.runId, stage: 'memory_index' })
      }
    }
    if (result.status === 'completed') {
      try {
        const contextCompactor =
          dependencies.contextCompactor === undefined
            ? persistence === chatRepository
              ? (record: {
                  userId: string
                  conversationId: string
                  modelConnection: ModelConnection
                  adapter: ModelProviderAdapter
                  signal: AbortSignal
                }) => compactCompletedChatConversation(record, { adapter: record.adapter })
              : null
            : dependencies.contextCompactor

        await contextCompactor?.({
          userId: input.userId,
          conversationId: input.conversationId,
          modelConnection: input.modelConnection,
          adapter,
          signal: controller.signal,
        })
      } catch (error) {
        // 上下文摘要只是下一轮的派生缓存；失败不能反向修改已完成的 ChatRun。
        if (!controller.signal.aborted) logError(error, { runId: input.runId, stage: 'context_compaction' })
      }
    }
  } catch (error) {
    logError(error, { runId: input.runId, stage: 'run' })
  } finally {
    if (activeChatRuns.get(input.runId) === activeRun) activeChatRuns.delete(input.runId)
    activeRun.resolveSettled()
  }
}
