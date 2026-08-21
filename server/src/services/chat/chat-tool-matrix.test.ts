import assert from 'node:assert/strict'
import test from 'node:test'
import type { ActionStrategyOverview } from '@/types/action-strategy'
import type { CapabilityProfile } from '@/types/capability'
import type { JobOpportunityRecord } from '../../repositories/opportunity.repository'
import type { ResumeRecord } from '../../repositories/resume.repository'
import { AgentRuntime } from './agent-runtime'
import type { ModelProviderAdapter, ModelProviderStreamEvent, ModelProviderStreamInput } from './model-provider-adapter'
import { createChatToolRegistry, type ChatToolRegistryDependencies } from './chat-tools'

const opportunity: JobOpportunityRecord = {
  id: '00000000-0000-4000-8000-000000000301',
  userId: 'user-1',
  company: '微派',
  jobTitle: '前端开发工程师',
  dedupeFingerprint: null,
  address: ['武汉'],
  introduction: '',
  description: '负责海外 H5 业务',
  status: 'interviewing',
  includeWrittenTest: true,
  intentionLevel: 'A',
  industry: '互联网',
  note: '',
  writtenTestScheduledAt: null,
  writtenTestReviewNote: null,
  writtenTestReviewedAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
}

const resume: ResumeRecord = {
  id: '00000000-0000-4000-8000-000000000302',
  userId: 'user-1',
  title: '前端开发主线',
  currentVersionId: '00000000-0000-4000-8000-000000000303',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
}

const emptyCapabilityProfile: CapabilityProfile = {
  generatedAt: '2026-08-10T00:00:00.000Z',
  dataStatus: 'empty',
  scope: {
    resumeId: resume.id,
    resumeTitle: resume.title,
    currentVersionId: resume.currentVersionId,
    currentVersionNumber: 1,
    targetDirection: '前端开发',
  },
  resumeDeclaration: null,
  sourceCounts: {
    resumeDeclaration: 0,
    jdAnalyses: 0,
    completedJdAnalyses: 0,
    pendingJdAnalyses: 0,
    failedJdAnalyses: 0,
    simulatedSessions: 0,
  },
  jdOverview: {
    indexingStatus: 'ready',
    analyzedOpportunityCount: 0,
    indexedOpportunityCount: 0,
    strengthThemes: [],
    gapThemes: [],
  },
  jdSignals: [],
  interview: { strengths: [], weaknesses: [], historicalWeaknesses: [], sessions: [] },
}

const emptyActionStrategy: ActionStrategyOverview = {
  generatedAt: '2026-08-10T00:00:00.000Z',
  currentFingerprint: 'empty-fingerprint',
  sourceSummary: {
    opportunityCount: 0,
    upcomingEventCount: 0,
    stalledOpportunityCount: 0,
    completedAnalysisCount: 0,
    capabilityEvidenceCount: 0,
  },
  actions: [],
  capabilityActions: [],
  ai: {
    freshness: 'not_generated',
    status: 'not_generated',
    snapshotId: null,
    modelName: null,
    generatedAt: null,
    expiresAt: null,
    staleReasons: [],
    summary: null,
    error: null,
  },
}

function createCompleteDependencies(): ChatToolRegistryDependencies {
  return {
    findOpportunitiesByUserId: async () => [opportunity],
    findResumesByUserId: async () => [resume],
    getOpportunityContextForUser: async ({ opportunityId, sections }) => ({ opportunityId, sections }),
    getCapabilityProfileForUser: async () => emptyCapabilityProfile,
    getActionStrategyOverviewForUser: async () => emptyActionStrategy,
    importOpportunitiesFromUrls: async ({ urls }) => ({
      items: urls.map((url) => ({
        url,
        status: 'ready' as const,
        preview: {
          source: { type: 'url' as const, label: new URL(url).hostname, url },
          sourceUrl: url,
          company: '示例公司',
          jobTitle: '前端工程师',
          address: ['上海'],
          introduction: '负责前端业务。',
          description: '熟悉 Vue。',
          missingRequiredFields: [],
          warning: null,
        },
      })),
    }),
    importOpportunityFromText: async () => ({
      source: { type: 'text', label: '粘贴文本', url: null },
      sourceUrl: null,
      company: '示例公司',
      jobTitle: '前端工程师',
      address: ['上海'],
      introduction: '负责前端业务。',
      description: '熟悉 Vue。',
      missingRequiredFields: [],
      warning: null,
    }),
    updateOpportunityProfileForUser: async () => ({ opportunity, alreadyApplied: false }),
    batchUpdateOpportunityProfilesForUser: async () => ({ opportunities: [opportunity], alreadyApplied: false }),
    transitionOpportunityStatusForUser: async () => ({ opportunity, alreadyApplied: false }),
    terminateOpportunityForUser: async () => ({
      opportunity: { ...opportunity, status: 'closed' },
      alreadyApplied: false,
    }),
    createInterviewScheduleForUser: async () => ({
      round: {
        id: '00000000-0000-4000-8000-000000000304',
        scheduledAt: '2026-08-18T19:00:00+08:00',
        title: '项目面',
        type: 'project',
      },
      alreadyApplied: false,
    }),
    createMockInterviewForUser: async () => ({
      session: { id: '00000000-0000-4000-8000-000000000305', status: 'preparing' },
      alreadyApplied: false,
    }),
    saveWrittenTestReviewForUser: async () => ({ opportunity, alreadyApplied: false }),
    findInterviewRoundsByOpportunityId: async () => [],
    saveInterviewReviewForUser: async () => {
      throw new Error('矩阵测试不会执行面试复盘写入')
    },
  }
}

const toolMatrix = [
  { name: 'search_opportunities', scopes: ['global'], risk: 'read' },
  { name: 'get_opportunity_context', scopes: ['global'], risk: 'read' },
  { name: 'get_capability_profile', scopes: ['global'], risk: 'read' },
  { name: 'get_action_strategy', scopes: ['global'], risk: 'read' },
  { name: 'import_opportunities_from_urls', scopes: ['global'], risk: 'read' },
  { name: 'import_opportunity_from_text', scopes: ['global'], risk: 'read' },
  { name: 'update_opportunity_profile', scopes: ['global', 'opportunity'], risk: 'write' },
  { name: 'batch_update_opportunity_profiles', scopes: ['global'], risk: 'write' },
  { name: 'transition_opportunity_status', scopes: ['global', 'opportunity'], risk: 'write' },
  { name: 'terminate_opportunity', scopes: ['global', 'opportunity'], risk: 'input_confirmed_write' },
  { name: 'create_interview_schedule', scopes: ['global', 'opportunity'], risk: 'write' },
  { name: 'create_mock_interview', scopes: ['global', 'opportunity'], risk: 'write' },
  { name: 'save_written_test_review', scopes: ['global', 'opportunity'], risk: 'write' },
  { name: 'save_interview_review', scopes: ['global', 'opportunity'], risk: 'write' },
] as const

test('工具注册矩阵固定会话范围，并要求所有写入工具经过用户交互', () => {
  const dependencies = createCompleteDependencies()
  const registries = {
    global: createChatToolRegistry({ userId: 'user-1', scopeType: 'global' }, dependencies),
    opportunity: createChatToolRegistry({ userId: 'user-1', scopeType: 'opportunity', opportunity }, dependencies),
  }

  for (const scope of ['global', 'opportunity'] as const) {
    const exposedNames = registries[scope]
      .toProviderTools()
      .map((tool) => tool.name)
      .sort()
    const expectedNames = toolMatrix
      .filter((row) => row.scopes.some((rowScope) => rowScope === scope))
      .map((row) => row.name)
      .sort()
    assert.deepEqual(exposedNames, expectedNames)
  }

  for (const row of toolMatrix) {
    for (const scope of row.scopes) {
      const definition = registries[scope].get(row.name)
      assert.ok(definition, `${scope} 应注册 ${row.name}`)
      assert.equal(definition.requiresConfirmation, row.risk === 'write', `${row.name} 的风险等级配置错误`)
      if (row.risk === 'input_confirmed_write') {
        assert.ok(definition.prepareInput, `${row.name} 必须通过可编辑卡片取得用户确认`)
      }
    }
  }

  assert.ok(registries.opportunity.get('update_opportunity_intention_level'))
  assert.equal(
    registries.opportunity.toProviderTools().some((tool) => tool.name === 'update_opportunity_intention_level'),
    false,
    '旧意向工具只允许恢复历史 checkpoint，不能继续暴露给模型',
  )
})

class MatrixAdapter implements ModelProviderAdapter {
  readonly inputs: ModelProviderStreamInput[] = []

  constructor(
    private readonly toolName: string,
    private readonly argumentsValue: Record<string, unknown>,
  ) {}

  async *stream(input: ModelProviderStreamInput): AsyncGenerator<ModelProviderStreamEvent> {
    this.inputs.push(input)
    if (this.inputs.length === 1) {
      yield { type: 'tool_call', callId: `call-${this.toolName}`, name: this.toolName, arguments: this.argumentsValue }
      yield { type: 'completed', finishReason: 'tool_call', tokenUsage: null }
      return
    }

    yield { type: 'text_delta', text: `${this.toolName} 已返回结果` }
    yield { type: 'completed', finishReason: 'stop', tokenUsage: null }
  }
}

const readToolRuntimeCases = [
  {
    name: 'search_opportunities',
    arguments: { statuses: [], intentionLevels: [], limit: 10 },
  },
  {
    name: 'get_opportunity_context',
    arguments: { opportunityReference: '微派', sections: ['profile'] },
  },
  { name: 'get_capability_profile', arguments: {} },
  { name: 'get_action_strategy', arguments: {} },
  { name: 'import_opportunities_from_urls', arguments: { urls: ['https://jobs.example.com/frontend'] } },
  {
    name: 'import_opportunity_from_text',
    arguments: { text: '示例公司正在招聘前端工程师，负责前端业务，要求熟悉 Vue 和 TypeScript。' },
  },
] as const

test('全局只读工具运行矩阵全部经过 Runtime 执行并回到第二次模型回答', async () => {
  for (const runtimeCase of readToolRuntimeCases) {
    const adapter = new MatrixAdapter(runtimeCase.name, runtimeCase.arguments)
    const registry = createChatToolRegistry({ userId: 'user-1', scopeType: 'global' }, createCompleteDependencies())
    const result = await new AgentRuntime(adapter).run({
      modelConnection: { baseUrl: 'https://example.com/v1', modelName: 'test-model', apiKey: 'test-key' },
      messages: [{ role: 'user', content: `测试 ${runtimeCase.name}` }],
      toolRegistry: registry,
      signal: new AbortController().signal,
    })

    assert.equal(result.status, 'completed')
    assert.equal(result.modelCalls, 2)
    assert.equal(result.toolResults.length, 1)
    assert.equal(result.toolResults[0]?.call.name, runtimeCase.name)
    assert.equal(adapter.inputs.length, 2)
    assert.equal(adapter.inputs[1]?.messages.at(-1)?.role, 'tool')
  }
})
