import assert from 'node:assert/strict'
import test from 'node:test'
import type { JobOpportunityRecord } from '../../repositories/opportunity.repository'
import type { ResumeRecord } from '../../repositories/resume.repository'
import type { ActionStrategyOverview } from '@/types/action-strategy'
import type { CapabilityProfile } from '@/types/capability'
import { createChatToolRegistry } from './chat-tools'

function createOpportunity(
  overrides: Partial<JobOpportunityRecord> & Pick<JobOpportunityRecord, 'id' | 'company' | 'jobTitle'>,
): JobOpportunityRecord {
  const { id, company, jobTitle, ...rest } = overrides

  return {
    id,
    userId: 'user-1',
    company,
    jobTitle,
    dedupeFingerprint: null,
    address: ['上海'],
    introduction: '',
    description: '岗位描述',
    status: 'pending_apply',
    includeWrittenTest: false,
    intentionLevel: 'B',
    industry: '互联网',
    note: '',
    writtenTestScheduledAt: null,
    writtenTestReviewNote: null,
    writtenTestReviewedAt: null,
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
    ...rest,
  }
}

test('全局会话注册 search_opportunities，并按当前用户、状态和关键词筛选', async () => {
  let receivedUserId = ''
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'global' },
    {
      findOpportunitiesByUserId: async (userId) => {
        receivedUserId = userId
        return [
          createOpportunity({
            id: 'opportunity-1',
            company: '小米',
            jobTitle: '前端工程师',
            status: 'interviewing',
            intentionLevel: 'S',
          }),
          createOpportunity({
            id: 'opportunity-2',
            company: 'Bilibili',
            jobTitle: '前端开发',
            status: 'interviewing',
            intentionLevel: 'A',
          }),
          createOpportunity({
            id: 'opportunity-3',
            company: '小米',
            jobTitle: '测试工程师',
            status: 'applied',
            intentionLevel: 'B',
          }),
        ]
      },
    },
  )

  const tool = registry.get('search_opportunities')
  assert.ok(tool)
  assert.equal(tool.requiresConfirmation, false)

  const result = await tool.execute(
    { keyword: '小米', statuses: ['interviewing'], intentionLevels: [], limit: 10 },
    { signal: new AbortController().signal },
  )

  assert.equal(receivedUserId, 'user-1')
  assert.equal(result.matchedCount, 1)
  assert.equal(result.returnedCount, 1)
  assert.equal(result.hasMore, false)
  assert.deepEqual(result.query, {
    keyword: '小米',
    statuses: ['interviewing'],
    intentionLevels: [],
  })
  assert.deepEqual(result.opportunities, [
    {
      id: 'opportunity-1',
      company: '小米',
      jobTitle: '前端工程师',
      status: 'interviewing',
      statusLabel: '面试中',
      intentionLevel: 'S',
      industry: '互联网',
      address: ['上海'],
      updatedAt: '2026-08-08T00:00:00.000Z',
    },
  ])
})

test('机会查询在后端按已有 JD 匹配分筛选，不需要逐条读取机会详情', async () => {
  const opportunities = [
    createOpportunity({
      id: '00000000-0000-4000-8000-000000000401',
      company: '美团',
      jobTitle: '前端工程师',
      address: ['北京'],
    }),
    createOpportunity({
      id: '00000000-0000-4000-8000-000000000402',
      company: '美团',
      jobTitle: '前端工程师',
      address: ['上海'],
    }),
    createOpportunity({
      id: '00000000-0000-4000-8000-000000000403',
      company: '美团',
      jobTitle: '前端工程师',
      address: ['成都'],
    }),
  ]
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'global' },
    {
      findOpportunitiesByUserId: async () => opportunities,
      findOpportunityAnalysisProgressByIds: async (opportunityIds) => {
        assert.deepEqual(opportunityIds, [
          '00000000-0000-4000-8000-000000000401',
          '00000000-0000-4000-8000-000000000402',
          '00000000-0000-4000-8000-000000000403',
        ])
        return [
          { opportunityId: '00000000-0000-4000-8000-000000000401', status: 'completed', matchScore: '69' },
          { opportunityId: '00000000-0000-4000-8000-000000000402', status: 'completed', matchScore: '70' },
          { opportunityId: '00000000-0000-4000-8000-000000000403', status: 'completed', matchScore: '71' },
        ]
      },
    },
  )

  const tool = registry.get('search_opportunities')
  assert.ok(tool)
  const result = await tool.execute(
    {
      keyword: '美团',
      statuses: [],
      intentionLevels: [],
      maximumMatchScore: 70,
      limit: 20,
    },
    { signal: new AbortController().signal },
  )

  assert.equal(result.matchedCount, 2)
  assert.deepEqual(
    (result.opportunities as Array<{ id: string; matchScore: number }>).map(({ id, matchScore }) => ({
      id,
      matchScore,
    })),
    [
      { id: '00000000-0000-4000-8000-000000000401', matchScore: 69 },
      { id: '00000000-0000-4000-8000-000000000402', matchScore: 70 },
    ],
  )
})

test('同公司同岗位可通过城市唯一确定目标，避免重复弹出同名候选卡', async () => {
  const opportunities = [
    createOpportunity({
      id: '00000000-0000-4000-8000-000000000411',
      company: '美团',
      jobTitle: '前端工程师',
      address: ['北京'],
    }),
    createOpportunity({
      id: '00000000-0000-4000-8000-000000000412',
      company: '美团',
      jobTitle: '前端工程师',
      address: ['上海'],
    }),
  ]
  let receivedOpportunityId = ''
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'global' },
    {
      findOpportunitiesByUserId: async () => opportunities,
      getOpportunityContextForUser: async ({ opportunityId }) => {
        receivedOpportunityId = opportunityId
        return { opportunityId }
      },
    },
  )

  const tool = registry.get('get_opportunity_context')
  assert.ok(tool?.prepareInput)
  const prepared = await tool.prepareInput(
    { opportunityReference: '美团前端工程师上海', sections: ['job_analysis'] },
    undefined,
    { signal: new AbortController().signal },
  )
  assert.equal(prepared.status, 'ready')
  if (prepared.status !== 'ready') throw new Error('带城市的机会引用应该唯一命中')
  await tool.execute(prepared.input, { signal: new AbortController().signal })
  assert.equal(receivedOpportunityId, '00000000-0000-4000-8000-000000000412')
})

test('全局机会详情工具唯一匹配时直接读取有界上下文', async () => {
  const opportunities = [
    createOpportunity({
      id: '00000000-0000-4000-8000-000000000101',
      company: '微派',
      jobTitle: '前端开发工程师',
      status: 'oc',
      intentionLevel: 'A',
    }),
  ]
  const received: Array<Record<string, unknown>> = []
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'global' },
    {
      findOpportunitiesByUserId: async () => opportunities,
      getOpportunityContextForUser: async (record) => {
        received.push(record)
        return { opportunity: { id: record.opportunityId }, requestedSections: record.sections }
      },
    },
  )
  const tool = registry.get('get_opportunity_context')
  assert.ok(tool?.prepareInput)
  assert.equal(tool.requiresConfirmation, false)

  const prepared = await tool.prepareInput(
    { opportunityReference: '微派', sections: ['profile', 'job_analysis'] },
    undefined,
    { signal: new AbortController().signal },
  )
  assert.deepEqual(prepared, {
    status: 'ready',
    input: {
      opportunityReference: '微派',
      opportunityId: opportunities[0]!.id,
      sections: ['profile', 'job_analysis'],
    },
  })
  if (prepared.status !== 'ready') throw new Error('唯一机会应该直接完成目标解析')

  const output = await tool.execute(prepared.input, { signal: new AbortController().signal })
  assert.deepEqual(received, [
    {
      userId: 'user-1',
      opportunityId: opportunities[0]!.id,
      sections: ['profile', 'job_analysis'],
    },
  ])
  assert.deepEqual(output.requestedSections, ['profile', 'job_analysis'])
})

test('全局机会详情工具遇到同名机会时暂停并用用户选择恢复同一工具', async () => {
  const opportunities = [
    createOpportunity({
      id: '00000000-0000-4000-8000-000000000111',
      company: '小米',
      jobTitle: '前端工程师',
    }),
    createOpportunity({
      id: '00000000-0000-4000-8000-000000000112',
      company: '小米',
      jobTitle: '前端工程师（商业化）',
    }),
  ]
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'global' },
    {
      findOpportunitiesByUserId: async () => opportunities,
      getOpportunityContextForUser: async () => ({}),
    },
  )
  const tool = registry.get('get_opportunity_context')
  assert.ok(tool?.prepareInput)

  const waiting = await tool.prepareInput({ opportunityReference: '小米', sections: ['profile'] }, undefined, {
    signal: new AbortController().signal,
  })
  assert.equal(waiting.status, 'waiting_input')
  if (waiting.status !== 'waiting_input') throw new Error('同名机会应该等待用户选择')
  assert.deepEqual(waiting.missingArguments, ['opportunityId'])
  assert.equal(waiting.presentation.kind, 'opportunity_target_input')
  assert.equal(waiting.presentation.reason, 'ambiguous_reference')
  assert.equal((waiting.presentation.candidates as unknown[]).length, 2)

  const ready = await tool.prepareInput(
    waiting.input,
    { opportunityId: opportunities[1]!.id },
    { signal: new AbortController().signal },
  )
  assert.deepEqual(ready, {
    status: 'ready',
    input: {
      opportunityReference: '小米',
      opportunityId: opportunities[1]!.id,
      sections: ['profile'],
    },
  })
})

test('全局机会详情工具拒绝用户选择不属于当前用户的机会 ID', async () => {
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'global' },
    {
      findOpportunitiesByUserId: async () => [
        createOpportunity({
          id: '00000000-0000-4000-8000-000000000121',
          company: '小米',
          jobTitle: '前端工程师',
        }),
      ],
      getOpportunityContextForUser: async () => ({}),
    },
  )
  const tool = registry.get('get_opportunity_context')
  assert.ok(tool?.prepareInput)

  await assert.rejects(
    async () =>
      await tool.prepareInput!(
        { sections: ['profile'] },
        { opportunityId: '00000000-0000-4000-8000-000000000999' },
        { signal: new AbortController().signal },
      ),
    /不存在或不属于当前用户/,
  )
})

test('全局没有任何机会时返回可回答的空结果，而不是把 ChatRun 标记为失败', async () => {
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'global' },
    {
      findOpportunitiesByUserId: async () => [],
      getOpportunityContextForUser: async () => {
        throw new Error('空结果不应查询机会详情')
      },
    },
  )
  const tool = registry.get('get_opportunity_context')
  assert.ok(tool?.prepareInput)

  const prepared = await tool.prepareInput({ sections: ['profile'] }, undefined, {
    signal: new AbortController().signal,
  })
  assert.deepEqual(prepared, {
    status: 'ready',
    input: { opportunityId: null, sections: ['profile'] },
  })
  if (prepared.status !== 'ready') throw new Error('空机会列表应该进入可执行分支')

  const output = await tool.execute(prepared.input, { signal: new AbortController().signal })
  assert.equal(output.status, 'empty')
})

test('全局资料修改工具先确定唯一机会，再复用确认卡和并发快照执行写入', async () => {
  const opportunity = createOpportunity({
    id: '00000000-0000-4000-8000-000000000131',
    company: '微派',
    jobTitle: '前端开发工程师',
    intentionLevel: 'B',
  })
  const updateRecords: Array<Record<string, unknown>> = []
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'global' },
    {
      findOpportunitiesByUserId: async () => [opportunity],
      updateOpportunityProfileForUser: async (record) => {
        updateRecords.push(record)
        return {
          opportunity: { ...opportunity, ...record.patch, updatedAt: '2026-08-10T01:00:00.000Z' },
          alreadyApplied: false,
        }
      },
    },
  )
  const tool = registry.get('update_opportunity_profile')
  assert.ok(tool?.prepareInput)

  const prepared = await tool.prepareInput(
    { opportunityReference: '微派', intentionLevel: 'A', note: '优先跟进' },
    undefined,
    { signal: new AbortController().signal },
  )
  assert.equal(prepared.status, 'ready')
  if (prepared.status !== 'ready') throw new Error('唯一机会应直接完成目标解析')
  assert.equal(prepared.input.opportunityId, opportunity.id)

  const confirmation = await tool.prepareConfirmation?.(prepared.input, {
    signal: new AbortController().signal,
  })
  assert.equal(confirmation?.presentation.kind, 'opportunity_profile_change')
  assert.equal(confirmation?.presentation.opportunityId, opportunity.id)

  const output = await tool.execute(prepared.input, {
    signal: new AbortController().signal,
    confirmationContext: confirmation?.executionContext,
  })
  assert.deepEqual(updateRecords[0]?.patch, { intentionLevel: 'A', note: '优先跟进' })
  assert.equal(output.status, 'updated')
})

test('全局资料修改工具遇到同名机会时等待选择，并保留原修改参数', async () => {
  const opportunities = [
    createOpportunity({
      id: '00000000-0000-4000-8000-000000000141',
      company: '小米',
      jobTitle: '前端工程师',
    }),
    createOpportunity({
      id: '00000000-0000-4000-8000-000000000142',
      company: '小米',
      jobTitle: '前端工程师（商业化）',
    }),
  ]
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'global' },
    {
      findOpportunitiesByUserId: async () => opportunities,
      updateOpportunityProfileForUser: async () => ({ opportunity: opportunities[0]!, alreadyApplied: false }),
    },
  )
  const tool = registry.get('update_opportunity_profile')
  assert.ok(tool?.prepareInput)

  const waiting = await tool.prepareInput({ opportunityReference: '小米', note: '准备二面' }, undefined, {
    signal: new AbortController().signal,
  })
  assert.equal(waiting.status, 'waiting_input')
  if (waiting.status !== 'waiting_input') throw new Error('同名机会应该等待用户选择')
  assert.equal(waiting.presentation.kind, 'opportunity_target_input')
  assert.equal(waiting.presentation.title, '选择要修改的机会')
  assert.equal(waiting.input.note, '准备二面')

  const ready = await tool.prepareInput(
    waiting.input,
    { opportunityId: opportunities[1]!.id },
    { signal: new AbortController().signal },
  )
  assert.equal(ready.status, 'ready')
  if (ready.status !== 'ready') throw new Error('用户选择后应该恢复同一个修改工具')
  assert.equal(ready.input.opportunityId, opportunities[1]!.id)
  assert.equal(ready.input.note, '准备二面')
})

test('全局阶段修改工具解析目标后生成现有阶段确认卡', async () => {
  const opportunity = createOpportunity({
    id: '00000000-0000-4000-8000-000000000151',
    company: 'Bilibili',
    jobTitle: '前端工程师',
    status: 'applied',
  })
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'global' },
    {
      findOpportunitiesByUserId: async () => [opportunity],
      transitionOpportunityStatusForUser: async (record) => ({
        opportunity: { ...opportunity, status: record.nextStatus },
        alreadyApplied: false,
      }),
    },
  )
  const tool = registry.get('transition_opportunity_status')
  assert.ok(tool?.prepareInput)

  const prepared = await tool.prepareInput({ opportunityReference: 'Bilibili', status: 'interviewing' }, undefined, {
    signal: new AbortController().signal,
  })
  assert.equal(prepared.status, 'ready')
  if (prepared.status !== 'ready') throw new Error('唯一机会应直接完成目标解析')
  const confirmation = await tool.prepareConfirmation?.(prepared.input, {
    signal: new AbortController().signal,
  })
  assert.equal(confirmation?.presentation.kind, 'opportunity_status_transition')
  assert.equal(confirmation?.presentation.before, 'applied')
  assert.equal(confirmation?.presentation.after, 'interviewing')
})

test('全局批量资料修改工具用一张确认卡提交多个机会', async () => {
  const opportunities = [
    createOpportunity({
      id: '00000000-0000-4000-8000-000000000161',
      company: '微派',
      jobTitle: '前端开发',
      intentionLevel: 'B',
    }),
    createOpportunity({
      id: '00000000-0000-4000-8000-000000000162',
      company: '小米',
      jobTitle: '前端工程师',
      intentionLevel: 'C',
    }),
  ]
  const batchRecords: Array<Record<string, unknown>> = []
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'global' },
    {
      findOpportunitiesByUserId: async () => opportunities,
      updateOpportunityProfileForUser: async () => ({ opportunity: opportunities[0]!, alreadyApplied: false }),
      batchUpdateOpportunityProfilesForUser: async (record) => {
        batchRecords.push(record)
        return {
          opportunities: opportunities.map((opportunity, index) => ({
            ...opportunity,
            ...record.updates[index]!.patch,
          })),
          alreadyApplied: false,
        }
      },
    },
  )
  const tool = registry.get('batch_update_opportunity_profiles')
  assert.ok(tool?.prepareInput)

  const prepared = await tool.prepareInput(
    {
      operations: [
        { opportunityReference: '微派', intentionLevel: 'A' },
        { opportunityReference: '小米', note: '优先跟进' },
      ],
    },
    undefined,
    { signal: new AbortController().signal },
  )
  assert.equal(prepared.status, 'ready')
  if (prepared.status !== 'ready') throw new Error('两个唯一机会应该完成目标解析')

  const confirmation = await tool.prepareConfirmation?.(prepared.input, {
    signal: new AbortController().signal,
  })
  assert.equal(confirmation?.presentation.kind, 'opportunity_profile_batch_change')
  assert.equal((confirmation?.presentation.items as unknown[]).length, 2)

  const output = await tool.execute(prepared.input, {
    signal: new AbortController().signal,
    confirmationContext: confirmation?.executionContext,
  })
  assert.equal(batchRecords.length, 1)
  assert.equal((batchRecords[0]?.updates as unknown[]).length, 2)
  assert.equal(output.updatedCount, 2)
})

test('批量资料修改遇到歧义时逐项选择，并保留其他机会的修改内容', async () => {
  const opportunities = [
    createOpportunity({
      id: '00000000-0000-4000-8000-000000000171',
      company: '小米',
      jobTitle: '前端工程师',
    }),
    createOpportunity({
      id: '00000000-0000-4000-8000-000000000172',
      company: '小米',
      jobTitle: '前端工程师（商业化）',
    }),
    createOpportunity({
      id: '00000000-0000-4000-8000-000000000173',
      company: 'Bilibili',
      jobTitle: '前端开发',
    }),
  ]
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'global' },
    {
      findOpportunitiesByUserId: async () => opportunities,
      updateOpportunityProfileForUser: async () => ({ opportunity: opportunities[0]!, alreadyApplied: false }),
      batchUpdateOpportunityProfilesForUser: async () => ({ opportunities: [], alreadyApplied: false }),
    },
  )
  const tool = registry.get('batch_update_opportunity_profiles')
  assert.ok(tool?.prepareInput)

  const waiting = await tool.prepareInput(
    {
      operations: [
        { opportunityReference: '小米', note: '准备二面' },
        { opportunityReference: 'Bilibili', intentionLevel: 'A' },
      ],
    },
    undefined,
    { signal: new AbortController().signal },
  )
  assert.equal(waiting.status, 'waiting_input')
  if (waiting.status !== 'waiting_input') throw new Error('同名机会应该等待用户选择')
  assert.equal(waiting.presentation.title, '选择第 1 个目标机会')

  const ready = await tool.prepareInput(
    waiting.input,
    { opportunityId: opportunities[1]!.id },
    { signal: new AbortController().signal },
  )
  assert.equal(ready.status, 'ready')
  if (ready.status !== 'ready') throw new Error('选择歧义机会后应该继续解析剩余批量项')
  const operations = ready.input.operations as Array<Record<string, unknown>>
  assert.equal(operations[0]?.opportunityId, opportunities[1]!.id)
  assert.equal(operations[0]?.note, '准备二面')
  assert.equal(operations[1]?.opportunityId, opportunities[2]!.id)
  assert.equal(operations[1]?.intentionLevel, 'A')
})

test('全局面试安排工具解析唯一机会后复用现有确认和写入链路', async () => {
  const opportunity = createOpportunity({
    id: '00000000-0000-4000-8000-000000000181',
    company: '微派',
    jobTitle: '前端开发',
    status: 'interviewing',
  })
  const createdRecords: Array<Record<string, unknown>> = []
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'global' },
    {
      findOpportunitiesByUserId: async () => [opportunity],
      createInterviewScheduleForUser: async (record) => {
        createdRecords.push(record)
        return {
          round: {
            id: record.roundId,
            type: record.type,
            title: record.title,
            scheduledAt: record.scheduledAt,
          },
          alreadyApplied: false,
        }
      },
    },
  )
  const tool = registry.get('create_interview_schedule')
  assert.ok(tool?.prepareInput)

  const review = await tool.prepareInput(
    {
      opportunityReference: '微派',
      type: 'project',
      scheduledAt: '2099-08-12T19:00:00+08:00',
      note: '线上会议',
    },
    undefined,
    { signal: new AbortController().signal },
  )
  assert.equal(review.status, 'waiting_input')
  if (review.status !== 'waiting_input') throw new Error('完整安排也应先让用户核对')
  assert.deepEqual(review.missingArguments, [])
  assert.equal(review.presentation.title, '核对面试安排')

  const prepared = await tool.prepareInput(
    review.input,
    { type: 'project', scheduledAt: '2099-08-12T19:00:00+08:00', note: '线上会议' },
    { signal: new AbortController().signal },
  )
  assert.equal(prepared.status, 'ready')
  if (prepared.status !== 'ready') throw new Error('用户核对完整安排后应进入确认')
  assert.equal(prepared.input.opportunityId, opportunity.id)

  const confirmation = await tool.prepareConfirmation?.(prepared.input, {
    signal: new AbortController().signal,
  })
  assert.equal(confirmation?.presentation.kind, 'interview_schedule_create')
  assert.equal(confirmation?.presentation.opportunityId, opportunity.id)

  const output = await tool.execute(prepared.input, {
    signal: new AbortController().signal,
    confirmationContext: confirmation?.executionContext,
  })
  assert.equal(output.status, 'created')
  assert.equal(createdRecords[0]?.userId, 'user-1')
  assert.equal(createdRecords[0]?.opportunityId, opportunity.id)
  assert.equal(createdRecords[0]?.type, 'project')
})

test('全局面试安排先解决同名机会，再保留时间并补全面试类型', async () => {
  const opportunities = [
    createOpportunity({
      id: '00000000-0000-4000-8000-000000000191',
      company: '小米',
      jobTitle: '前端工程师',
      status: 'interviewing',
    }),
    createOpportunity({
      id: '00000000-0000-4000-8000-000000000192',
      company: '小米',
      jobTitle: '前端工程师（商业化）',
      status: 'interviewing',
    }),
  ]
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'global' },
    {
      findOpportunitiesByUserId: async () => opportunities,
      createInterviewScheduleForUser: async (record) => ({
        round: { id: record.roundId, type: record.type, title: record.title, scheduledAt: record.scheduledAt },
        alreadyApplied: false,
      }),
    },
  )
  const tool = registry.get('create_interview_schedule')
  assert.ok(tool?.prepareInput)

  const targetWaiting = await tool.prepareInput(
    { opportunityReference: '小米', scheduledAt: '2099-08-12T19:00:00+08:00' },
    undefined,
    { signal: new AbortController().signal },
  )
  assert.equal(targetWaiting.status, 'waiting_input')
  if (targetWaiting.status !== 'waiting_input') throw new Error('同名机会应先等待用户选择')
  assert.equal(targetWaiting.presentation.kind, 'opportunity_target_input')

  const scheduleWaiting = await tool.prepareInput(
    targetWaiting.input,
    { opportunityId: opportunities[1]!.id },
    { signal: new AbortController().signal },
  )
  assert.equal(scheduleWaiting.status, 'waiting_input')
  if (scheduleWaiting.status !== 'waiting_input') throw new Error('选定机会后仍应补全面试类型')
  assert.equal(scheduleWaiting.presentation.kind, 'interview_schedule_input')
  assert.deepEqual(scheduleWaiting.missingArguments, ['type'])
  assert.equal(scheduleWaiting.input.opportunityId, opportunities[1]!.id)
  assert.equal(scheduleWaiting.input.scheduledAt, '2099-08-12T19:00:00+08:00')

  const ready = await tool.prepareInput(
    scheduleWaiting.input,
    { type: 'hr' },
    {
      signal: new AbortController().signal,
    },
  )
  assert.equal(ready.status, 'ready')
  if (ready.status !== 'ready') throw new Error('补齐类型后应进入确认')
  assert.equal(ready.input.opportunityId, opportunities[1]!.id)
  assert.equal(ready.input.type, 'hr')
  assert.equal(ready.input.scheduledAt, '2099-08-12T19:00:00+08:00')
})

test('全局面试安排拒绝给非面试中机会创建轮次', async () => {
  const opportunity = createOpportunity({
    id: '00000000-0000-4000-8000-000000000193',
    company: 'Bilibili',
    jobTitle: '前端开发',
    status: 'applied',
  })
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'global' },
    {
      findOpportunitiesByUserId: async () => [opportunity],
      createInterviewScheduleForUser: async () => {
        throw new Error('不应执行数据库写入')
      },
    },
  )
  const tool = registry.get('create_interview_schedule')
  assert.ok(tool?.prepareInput)

  await assert.rejects(
    async () =>
      await tool.prepareInput!(
        { opportunityReference: 'Bilibili', type: 'technical_basic', scheduledAt: '2099-08-12T19:00:00+08:00' },
        undefined,
        { signal: new AbortController().signal },
      ),
    /只有处于面试中阶段的机会才能创建面试安排/,
  )
})

test('全局模拟面试解析唯一机会后复用配置、确认和 Session 创建链路', async () => {
  const opportunity = createOpportunity({
    id: '00000000-0000-4000-8000-000000000194',
    company: '微派',
    jobTitle: '前端开发',
  })
  const createRecords: Array<Record<string, unknown>> = []
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'global' },
    {
      findOpportunitiesByUserId: async () => [opportunity],
      createMockInterviewForUser: async (record) => {
        createRecords.push(record)
        return { session: { id: record.sessionId, status: 'preparing' }, alreadyApplied: false }
      },
    },
  )
  const tool = registry.get('create_mock_interview')
  assert.ok(tool?.prepareInput)

  const waiting = await tool.prepareInput({ opportunityReference: '微派', difficulty: 'basic' }, undefined, {
    signal: new AbortController().signal,
  })
  assert.equal(waiting.status, 'waiting_input')
  if (waiting.status !== 'waiting_input') throw new Error('缺失配置时应该展示模拟面试配置卡')
  assert.equal(waiting.presentation.kind, 'mock_interview_input')
  assert.equal(waiting.presentation.opportunityId, opportunity.id)
  assert.deepEqual(waiting.missingArguments, ['type', 'scale', 'referenceHistoricalWeaknesses'])
  assert.equal(waiting.input.opportunityId, opportunity.id)

  const ready = await tool.prepareInput(
    waiting.input,
    { type: 'project', scale: 'quick', difficulty: 'basic', referenceHistoricalWeaknesses: false },
    { signal: new AbortController().signal },
  )
  assert.equal(ready.status, 'ready')
  if (ready.status !== 'ready') throw new Error('配置补全后应该进入确认')

  const confirmation = await tool.prepareConfirmation?.(ready.input, {
    signal: new AbortController().signal,
  })
  assert.equal(confirmation?.presentation.kind, 'mock_interview_create')
  assert.equal(confirmation?.presentation.opportunityId, opportunity.id)

  const output = await tool.execute(ready.input, {
    signal: new AbortController().signal,
    confirmationContext: confirmation?.executionContext,
  })
  assert.equal(output.status, 'created')
  assert.equal(output.sessionStatus, 'preparing')
  assert.equal(createRecords[0]?.userId, 'user-1')
  assert.equal(createRecords[0]?.opportunityId, opportunity.id)
})

test('全局模拟面试遇到同名机会时先选择目标，再继续补全原有配置', async () => {
  const opportunities = [
    createOpportunity({
      id: '00000000-0000-4000-8000-000000000195',
      company: '小米',
      jobTitle: '前端工程师',
    }),
    createOpportunity({
      id: '00000000-0000-4000-8000-000000000196',
      company: '小米',
      jobTitle: '前端工程师（商业化）',
    }),
  ]
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'global' },
    {
      findOpportunitiesByUserId: async () => opportunities,
      createMockInterviewForUser: async (record) => ({
        session: { id: record.sessionId, status: 'preparing' },
        alreadyApplied: false,
      }),
    },
  )
  const tool = registry.get('create_mock_interview')
  assert.ok(tool?.prepareInput)

  const targetWaiting = await tool.prepareInput({ opportunityReference: '小米', difficulty: 'advanced' }, undefined, {
    signal: new AbortController().signal,
  })
  assert.equal(targetWaiting.status, 'waiting_input')
  if (targetWaiting.status !== 'waiting_input') throw new Error('同名机会应该先等待目标选择')
  assert.equal(targetWaiting.presentation.kind, 'opportunity_target_input')

  const configurationWaiting = await tool.prepareInput(
    targetWaiting.input,
    { opportunityId: opportunities[1]!.id },
    { signal: new AbortController().signal },
  )
  assert.equal(configurationWaiting.status, 'waiting_input')
  if (configurationWaiting.status !== 'waiting_input') throw new Error('目标确定后应该继续补全配置')
  assert.equal(configurationWaiting.presentation.kind, 'mock_interview_input')
  assert.equal(configurationWaiting.input.opportunityId, opportunities[1]!.id)
  assert.equal(configurationWaiting.input.difficulty, 'advanced')
})

test('模拟面试工具补齐缺失配置，确认后使用服务端预算创建 Session', async () => {
  const opportunity = createOpportunity({
    id: '00000000-0000-4000-8000-000000000081',
    company: '微派',
    jobTitle: '前端开发工程师',
  })
  const createRecords: Array<Record<string, unknown>> = []
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'opportunity', opportunity },
    {
      findOpportunitiesByUserId: async () => [],
      updateOpportunityProfileForUser: async () => ({ opportunity, alreadyApplied: false }),
      transitionOpportunityStatusForUser: async () => ({ opportunity, alreadyApplied: false }),
      createMockInterviewForUser: async (record) => {
        createRecords.push(record)
        return { session: { id: record.sessionId, status: 'preparing' }, alreadyApplied: false }
      },
    },
  )

  const tool = registry.get('create_mock_interview')
  assert.ok(tool)
  assert.equal(tool.requiresConfirmation, true)

  const waiting = await tool.prepareInput?.({ difficulty: 'basic' }, undefined, {
    signal: new AbortController().signal,
  })
  assert.equal(waiting?.status, 'waiting_input')
  if (waiting?.status !== 'waiting_input') throw new Error('应等待用户补齐模拟面试配置')
  assert.deepEqual(waiting.missingArguments, ['type', 'scale', 'referenceHistoricalWeaknesses'])
  assert.deepEqual(waiting.presentation, {
    kind: 'mock_interview_input',
    title: '配置模拟面试',
    opportunityId: opportunity.id,
    company: '微派',
    jobTitle: '前端开发工程师',
    missingArguments: ['type', 'scale', 'referenceHistoricalWeaknesses'],
    values: { difficulty: 'basic' },
  })

  const ready = await tool.prepareInput?.(
    waiting.input,
    { type: 'foundation', scale: 'quick', referenceHistoricalWeaknesses: true },
    { signal: new AbortController().signal },
  )
  assert.deepEqual(ready, {
    status: 'ready',
    input: {
      type: 'foundation',
      scale: 'quick',
      difficulty: 'basic',
      referenceHistoricalWeaknesses: true,
    },
  })
  if (ready?.status !== 'ready') throw new Error('模拟面试配置应已完整')

  const confirmation = await tool.prepareConfirmation?.(ready.input, {
    signal: new AbortController().signal,
  })
  assert.equal(confirmation?.presentation.kind, 'mock_interview_create')
  assert.deepEqual(confirmation?.presentation.configuration, {
    type: 'foundation',
    scale: 'quick',
    difficulty: 'basic',
    referenceHistoricalWeaknesses: true,
    budget: { mainTopicBudget: 3, totalQuestionBudget: 5, maxFollowUpsPerRoot: 3 },
  })

  const output = await tool.execute(ready.input, {
    signal: new AbortController().signal,
    confirmationContext: confirmation?.executionContext,
  })
  assert.equal(createRecords[0]?.userId, 'user-1')
  assert.equal(createRecords[0]?.opportunityId, opportunity.id)
  assert.deepEqual(createRecords[0]?.configuration, confirmation?.presentation.configuration)
  assert.equal(output.status, 'created')
  assert.equal(output.sessionStatus, 'preparing')
})

test('机会内会话不注册跨机会搜索工具', () => {
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'opportunity' },
    { findOpportunitiesByUserId: async () => [] },
  )

  assert.equal(registry.get('search_opportunities'), undefined)
  assert.deepEqual(registry.toProviderTools(), [])
})

test('机会内会话注册资料修改工具，并把多个普通字段合并为一次确认', async () => {
  const opportunity = createOpportunity({
    id: '00000000-0000-4000-8000-000000000021',
    company: '小米',
    jobTitle: '前端工程师',
    intentionLevel: 'A',
  })
  const updateRecords: Array<Record<string, unknown>> = []
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'opportunity', opportunity },
    {
      findOpportunitiesByUserId: async () => [],
      updateOpportunityProfileForUser: async (record) => {
        updateRecords.push(record)
        return {
          opportunity: { ...opportunity, ...record.patch, updatedAt: '2026-08-09T00:00:00.000Z' },
          alreadyApplied: false,
        }
      },
      transitionOpportunityStatusForUser: async () => ({ opportunity, alreadyApplied: false }),
    },
  )

  const tool = registry.get('update_opportunity_profile')
  assert.ok(tool)
  assert.equal(tool.requiresConfirmation, true)
  assert.ok(registry.get('update_opportunity_intention_level'))
  assert.equal(
    registry.toProviderTools().some((definition) => definition.name === 'update_opportunity_intention_level'),
    false,
  )
  const providerTool = registry.toProviderTools().find((definition) => definition.name === 'update_opportunity_profile')
  assert.ok(providerTool)
  assert.equal(providerTool.inputSchema.anyOf, undefined)
  assert.equal(tool.inputValidator.safeParse({}).success, false)

  const prepared = await tool.prepareConfirmation?.(
    { intentionLevel: 'S', note: '优先跟进薪资' },
    { signal: new AbortController().signal },
  )
  assert.deepEqual(prepared?.presentation, {
    kind: 'opportunity_profile_change',
    title: '修改机会资料',
    opportunityId: opportunity.id,
    company: '小米',
    jobTitle: '前端工程师',
    changes: [
      { field: 'intentionLevel', label: '意向等级', before: 'A', after: 'S' },
      { field: 'note', label: '备注', before: '未填写', after: '优先跟进薪资' },
    ],
  })

  const output = await tool.execute(
    { intentionLevel: 'S', note: '优先跟进薪资' },
    { signal: new AbortController().signal, confirmationContext: prepared?.executionContext },
  )
  assert.equal(updateRecords[0]?.userId, 'user-1')
  assert.equal(updateRecords[0]?.expectedUpdatedAt, opportunity.updatedAt)
  assert.deepEqual(updateRecords[0]?.patch, { intentionLevel: 'S', note: '优先跟进薪资' })
  assert.deepEqual(output.changedFields, ['intentionLevel', 'note'])
})

test('资料修改工具关闭笔试流程时明确展示笔试阶段回退', async () => {
  const opportunity = createOpportunity({
    id: '00000000-0000-4000-8000-000000000024',
    company: '微派',
    jobTitle: '前端开发',
    status: 'written_test',
    includeWrittenTest: true,
  })
  const updateRecords: Array<Record<string, unknown>> = []
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'opportunity', opportunity },
    {
      findOpportunitiesByUserId: async () => [],
      updateOpportunityProfileForUser: async (record) => {
        updateRecords.push(record)
        return {
          opportunity: { ...opportunity, status: 'applied', includeWrittenTest: false },
          alreadyApplied: false,
        }
      },
      transitionOpportunityStatusForUser: async () => ({ opportunity, alreadyApplied: false }),
      saveWrittenTestReviewForUser: async () => ({ opportunity, alreadyApplied: false }),
    },
  )
  const tool = registry.get('update_opportunity_profile')
  assert.ok(tool)

  const prepared = await tool.prepareConfirmation?.(
    { includeWrittenTest: false },
    { signal: new AbortController().signal },
  )
  assert.deepEqual(prepared?.presentation, {
    kind: 'opportunity_profile_change',
    title: '修改机会资料',
    opportunityId: opportunity.id,
    company: '微派',
    jobTitle: '前端开发',
    changes: [
      { field: 'includeWrittenTest', label: '笔试流程', before: '已开启', after: '未开启' },
      { field: 'status', label: '机会阶段', before: '笔试中', after: '已投递' },
    ],
  })

  await tool.execute(
    { includeWrittenTest: false },
    { signal: new AbortController().signal, confirmationContext: prepared?.executionContext },
  )
  assert.deepEqual(updateRecords[0]?.patch, { includeWrittenTest: false })
})

test('机会阶段工具允许跨级前进，并在进入笔试中时把开启笔试写入可信确认上下文', async () => {
  const opportunity = createOpportunity({
    id: '00000000-0000-4000-8000-000000000022',
    company: 'Bilibili',
    jobTitle: '前端工程师',
    status: 'pending_apply',
    includeWrittenTest: false,
  })
  const transitions: Array<Record<string, unknown>> = []
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'opportunity', opportunity },
    {
      findOpportunitiesByUserId: async () => [opportunity],
      updateOpportunityProfileForUser: async () => ({ opportunity, alreadyApplied: false }),
      transitionOpportunityStatusForUser: async (record) => {
        transitions.push(record)
        return {
          opportunity: { ...opportunity, status: record.nextStatus, includeWrittenTest: true },
          alreadyApplied: false,
        }
      },
    },
  )
  const tool = registry.get('transition_opportunity_status')
  assert.ok(tool)

  const prepared = await tool.prepareConfirmation?.(
    { status: 'written_test' },
    { signal: new AbortController().signal },
  )
  assert.deepEqual(prepared?.presentation, {
    kind: 'opportunity_status_transition',
    title: '修改机会阶段',
    opportunityId: opportunity.id,
    company: 'Bilibili',
    jobTitle: '前端工程师',
    before: 'pending_apply',
    beforeLabel: '待投递',
    after: 'written_test',
    afterLabel: '笔试中',
    direction: 'forward',
    enableWrittenTest: true,
    warning: '确认后会同时开启该机会的笔试流程。',
  })
  const output = await tool.execute(
    { status: 'written_test' },
    { signal: new AbortController().signal, confirmationContext: prepared?.executionContext },
  )

  assert.equal(output.status, 'updated')
  assert.equal(transitions[0]?.expectedStatus, 'pending_apply')
  assert.equal(transitions[0]?.nextStatus, 'written_test')
  assert.equal(transitions[0]?.enableWrittenTest, true)
})

test('机会阶段工具把回退标记为高提示确认，但不会要求删除历史数据', async () => {
  const opportunity = createOpportunity({
    id: '00000000-0000-4000-8000-000000000023',
    company: '微派',
    jobTitle: '前端开发',
    status: 'oc',
  })
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'opportunity', opportunity },
    {
      findOpportunitiesByUserId: async () => [opportunity],
      updateOpportunityProfileForUser: async () => ({ opportunity, alreadyApplied: false }),
      transitionOpportunityStatusForUser: async () => ({
        opportunity: { ...opportunity, status: 'interviewing' },
        alreadyApplied: false,
      }),
    },
  )
  const tool = registry.get('transition_opportunity_status')
  assert.ok(tool)

  const prepared = await tool.prepareConfirmation?.(
    { status: 'interviewing' },
    { signal: new AbortController().signal },
  )
  assert.equal(prepared?.presentation.direction, 'backward')
  assert.equal(prepared?.presentation.warning, '已有面试安排、复盘和状态历史不会被删除。')
})

test('创建面试安排缺少类型和时间时等待补充，完整后生成确认卡并执行写入', async () => {
  const opportunity = createOpportunity({
    id: '00000000-0000-4000-8000-000000000031',
    company: '微派',
    jobTitle: '前端开发',
    status: 'interviewing',
  })
  const createdRecords: Array<Record<string, unknown>> = []
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'opportunity', opportunity },
    {
      findOpportunitiesByUserId: async () => [opportunity],
      updateOpportunityProfileForUser: async () => ({ opportunity, alreadyApplied: false }),
      transitionOpportunityStatusForUser: async () => ({ opportunity, alreadyApplied: false }),
      createInterviewScheduleForUser: async (record) => {
        createdRecords.push(record)
        return {
          round: {
            id: record.roundId,
            type: record.type,
            title: record.title,
            scheduledAt: record.scheduledAt,
          },
          alreadyApplied: false,
        }
      },
    },
  )
  const tool = registry.get('create_interview_schedule')
  assert.ok(tool?.prepareInput)

  const waiting = await tool.prepareInput({}, undefined, { signal: new AbortController().signal })
  assert.equal(waiting.status, 'waiting_input')
  if (waiting.status !== 'waiting_input') return
  assert.deepEqual(waiting.missingArguments, ['type', 'scheduledAt'])

  const ready = await tool.prepareInput(
    waiting.input,
    { type: 'project', scheduledAt: '2099-08-12T19:00:00+08:00', note: '线上会议' },
    { signal: new AbortController().signal },
  )
  assert.equal(ready.status, 'ready')
  if (ready.status !== 'ready') return

  const confirmation = await tool.prepareConfirmation?.(ready.input, { signal: new AbortController().signal })
  assert.equal(confirmation?.presentation.kind, 'interview_schedule_create')
  assert.equal(confirmation?.presentation.roundTypeLabel, '项目面')
  assert.equal(confirmation?.presentation.roundTitle, '项目面')

  const output = await tool.execute(ready.input, {
    signal: new AbortController().signal,
    confirmationContext: confirmation?.executionContext,
  })
  assert.equal(output.status, 'created')
  assert.equal(createdRecords[0]?.userId, 'user-1')
  assert.equal(createdRecords[0]?.opportunityId, opportunity.id)
  assert.equal(createdRecords[0]?.type, 'project')
})

test('笔试复盘缺少正文时等待补充，确认后按追加模式保存完整原文', async () => {
  const opportunity = createOpportunity({
    id: '00000000-0000-4000-8000-000000000041',
    company: '微派',
    jobTitle: '前端开发',
    status: 'written_test',
    includeWrittenTest: true,
    writtenTestScheduledAt: '2026-08-08T11:00:00.000Z',
    writtenTestReviewNote: '原复盘内容',
  })
  const savedRecords: Array<Record<string, unknown>> = []
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'opportunity', opportunity },
    {
      findOpportunitiesByUserId: async () => [],
      updateOpportunityProfileForUser: async () => ({ opportunity, alreadyApplied: false }),
      transitionOpportunityStatusForUser: async () => ({ opportunity, alreadyApplied: false }),
      saveWrittenTestReviewForUser: async (record) => {
        savedRecords.push(record)
        return {
          opportunity: {
            ...opportunity,
            writtenTestReviewNote: record.reviewNote,
            writtenTestScheduledAt: record.scheduledAt,
            writtenTestReviewedAt: '2026-08-10T10:00:00.000Z',
          },
          alreadyApplied: false,
        }
      },
    },
  )
  const tool = registry.get('save_written_test_review')
  assert.ok(tool?.prepareInput)

  const waiting = await tool.prepareInput({}, undefined, { signal: new AbortController().signal })
  assert.equal(waiting.status, 'waiting_input')
  if (waiting.status !== 'waiting_input') return
  assert.deepEqual(waiting.missingArguments, ['reviewNote'])
  assert.equal(waiting.presentation.kind, 'review_input')

  const ready = await tool.prepareInput(
    waiting.input,
    { reviewNote: '补充：算法题时间分配不合理。', mode: 'append' },
    { signal: new AbortController().signal },
  )
  assert.equal(ready.status, 'ready')
  if (ready.status !== 'ready') return

  const confirmation = await tool.prepareConfirmation?.(ready.input, { signal: new AbortController().signal })
  assert.equal(confirmation?.presentation.kind, 'review_save')
  assert.equal(confirmation?.presentation.mode, 'append')
  assert.equal(confirmation?.presentation.replacingExisting, false)

  const output = await tool.execute(ready.input, {
    signal: new AbortController().signal,
    confirmationContext: confirmation?.executionContext,
  })
  assert.equal(output.status, 'saved')
  assert.equal(savedRecords[0]?.userId, 'user-1')
  assert.equal(savedRecords[0]?.expectedUpdatedAt, opportunity.updatedAt)
  assert.equal(savedRecords[0]?.scheduledAt, '2026-08-08T11:00:00.000Z')
  assert.equal(savedRecords[0]?.reviewNote, '原复盘内容\n\n补充：算法题时间分配不合理。')
})

test('面试复盘有多个候选轮次时等待选择，确认后完成已发生的安排并保存原文', async () => {
  const opportunity = createOpportunity({
    id: '00000000-0000-4000-8000-000000000051',
    company: '微派',
    jobTitle: '前端开发',
    status: 'interviewing',
  })
  const rounds = [
    {
      id: '00000000-0000-4000-8000-000000000052',
      type: 'technical_basic' as const,
      sequence: 1,
      title: '一面',
      scheduledAt: '2020-08-08T11:00:00.000Z',
      status: 'completed' as const,
      result: 'passed' as const,
      note: '',
      reviewNote: '一面原复盘',
      keyTakeaways: [],
      createdAt: '2020-08-08T00:00:00.000Z',
      updatedAt: '2020-08-08T12:00:00.000Z',
    },
    {
      id: '00000000-0000-4000-8000-000000000053',
      type: 'project' as const,
      sequence: 2,
      title: '项目面',
      scheduledAt: '2020-08-09T11:00:00.000Z',
      status: 'planned' as const,
      result: 'pending' as const,
      note: '',
      reviewNote: '',
      keyTakeaways: [],
      createdAt: '2020-08-09T00:00:00.000Z',
      updatedAt: '2020-08-09T12:00:00.000Z',
    },
  ]
  const savedRecords: Array<Record<string, unknown>> = []
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'opportunity', opportunity },
    {
      findOpportunitiesByUserId: async () => [],
      updateOpportunityProfileForUser: async () => ({ opportunity, alreadyApplied: false }),
      transitionOpportunityStatusForUser: async () => ({ opportunity, alreadyApplied: false }),
      createInterviewScheduleForUser: async () => ({ round: rounds[1]!, alreadyApplied: false }),
      findInterviewRoundsByOpportunityId: async () => rounds,
      saveInterviewReviewForUser: async (record) => {
        savedRecords.push(record)
        return {
          round: {
            ...rounds[1]!,
            status: 'completed',
            result: record.result,
            scheduledAt: record.scheduledAt ?? '',
            reviewNote: record.reviewNote,
          },
          alreadyApplied: false,
        }
      },
    },
  )
  const tool = registry.get('save_interview_review')
  assert.ok(tool?.prepareInput)

  const waiting = await tool.prepareInput({ reviewNote: '项目架构追问没有讲清楚。' }, undefined, {
    signal: new AbortController().signal,
  })
  assert.equal(waiting.status, 'waiting_input')
  if (waiting.status !== 'waiting_input') return
  assert.deepEqual(waiting.missingArguments, ['roundId'])
  assert.equal(waiting.presentation.kind, 'review_input')
  assert.equal(waiting.presentation.target, null)
  assert.equal((waiting.presentation.targetOptions as unknown[]).length, 2)

  const ready = await tool.prepareInput(
    waiting.input,
    { roundId: rounds[1]!.id, result: 'failed' },
    { signal: new AbortController().signal },
  )
  assert.equal(ready.status, 'ready')
  if (ready.status !== 'ready') return

  const confirmation = await tool.prepareConfirmation?.(ready.input, { signal: new AbortController().signal })
  assert.equal(confirmation?.presentation.kind, 'review_save')
  assert.equal(confirmation?.presentation.completesPlannedRound, true)
  assert.equal(confirmation?.presentation.result, 'failed')

  const output = await tool.execute(ready.input, {
    signal: new AbortController().signal,
    confirmationContext: confirmation?.executionContext,
  })
  assert.equal(output.status, 'saved')
  assert.equal(savedRecords[0]?.roundId, rounds[1]!.id)
  assert.equal(savedRecords[0]?.expectedRoundUpdatedAt, rounds[1]!.updatedAt)
  assert.equal(savedRecords[0]?.result, 'failed')
  assert.equal(savedRecords[0]?.reviewNote, '项目架构追问没有讲清楚。')
})

test('面试复盘拒绝未来安排和已取消轮次，不会进入确认或写库', async () => {
  const opportunity = createOpportunity({
    id: '00000000-0000-4000-8000-000000000061',
    company: '微派',
    jobTitle: '前端开发',
    status: 'interviewing',
  })
  let saveCalled = false
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'opportunity', opportunity },
    {
      findOpportunitiesByUserId: async () => [],
      updateOpportunityProfileForUser: async () => ({ opportunity, alreadyApplied: false }),
      transitionOpportunityStatusForUser: async () => ({ opportunity, alreadyApplied: false }),
      createInterviewScheduleForUser: async () => {
        throw new Error('本测试不应创建安排')
      },
      findInterviewRoundsByOpportunityId: async () => [
        {
          id: '00000000-0000-4000-8000-000000000062',
          type: 'hr',
          sequence: 1,
          title: '未来 HR 面',
          scheduledAt: '2099-08-09T11:00:00.000Z',
          status: 'planned',
          result: 'pending',
          note: '',
          reviewNote: '',
          keyTakeaways: [],
          createdAt: '2026-08-09T00:00:00.000Z',
          updatedAt: '2026-08-09T12:00:00.000Z',
        },
        {
          id: '00000000-0000-4000-8000-000000000063',
          type: 'project',
          sequence: 2,
          title: '已取消项目面',
          scheduledAt: '2020-08-09T11:00:00.000Z',
          status: 'canceled',
          result: 'unknown',
          note: '',
          reviewNote: '',
          keyTakeaways: [],
          createdAt: '2020-08-09T00:00:00.000Z',
          updatedAt: '2020-08-09T12:00:00.000Z',
        },
      ],
      saveInterviewReviewForUser: async () => {
        saveCalled = true
        throw new Error('本测试不应写库')
      },
    },
  )
  const tool = registry.get('save_interview_review')
  assert.ok(tool?.prepareInput)

  await assert.rejects(
    async () =>
      tool.prepareInput?.({ reviewNote: '这段内容不应该被保存。' }, undefined, {
        signal: new AbortController().signal,
      }),
    /没有已经发生或已完成的面试轮次/,
  )
  assert.equal(saveCalled, false)
})

test('全局笔试复盘解析唯一机会后复用补全、确认和追加保存链路', async () => {
  const opportunity = createOpportunity({
    id: '00000000-0000-4000-8000-000000000071',
    company: '微派',
    jobTitle: '前端开发',
    status: 'written_test',
    includeWrittenTest: true,
    writtenTestScheduledAt: '2020-08-08T11:00:00.000Z',
    writtenTestReviewNote: '原复盘内容',
  })
  const savedRecords: Array<Record<string, unknown>> = []
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'global' },
    {
      findOpportunitiesByUserId: async () => [opportunity],
      saveWrittenTestReviewForUser: async (record) => {
        savedRecords.push(record)
        return {
          opportunity: {
            ...opportunity,
            writtenTestReviewNote: record.reviewNote,
            writtenTestScheduledAt: record.scheduledAt,
            writtenTestReviewedAt: '2026-08-10T10:00:00.000Z',
          },
          alreadyApplied: false,
        }
      },
    },
  )
  const tool = registry.get('save_written_test_review')
  assert.ok(tool?.prepareInput)

  const waiting = await tool.prepareInput({ opportunityReference: '微派' }, undefined, {
    signal: new AbortController().signal,
  })
  assert.equal(waiting.status, 'waiting_input')
  if (waiting.status !== 'waiting_input') throw new Error('缺少正文时应该展示笔试复盘表单')
  assert.equal(waiting.presentation.kind, 'review_input')
  assert.equal(waiting.presentation.opportunityId, opportunity.id)
  assert.equal(waiting.input.opportunityId, opportunity.id)

  const ready = await tool.prepareInput(
    waiting.input,
    { reviewNote: '补充：算法题时间分配不合理。', mode: 'append' },
    { signal: new AbortController().signal },
  )
  assert.equal(ready.status, 'ready')
  if (ready.status !== 'ready') throw new Error('补全笔试复盘后应该进入确认')

  const confirmation = await tool.prepareConfirmation?.(ready.input, { signal: new AbortController().signal })
  assert.equal(confirmation?.presentation.kind, 'review_save')
  assert.equal(confirmation?.presentation.opportunityId, opportunity.id)

  const output = await tool.execute(ready.input, {
    signal: new AbortController().signal,
    confirmationContext: confirmation?.executionContext,
  })
  assert.equal(output.status, 'saved')
  assert.equal(output.opportunityId, opportunity.id)
  assert.equal(savedRecords[0]?.userId, 'user-1')
  assert.equal(savedRecords[0]?.reviewNote, '原复盘内容\n\n补充：算法题时间分配不合理。')
})

test('全局笔试复盘拒绝未开启笔试流程的目标机会', async () => {
  const opportunity = createOpportunity({
    id: '00000000-0000-4000-8000-000000000072',
    company: 'Bilibili',
    jobTitle: '前端开发',
    includeWrittenTest: false,
  })
  let saveCalled = false
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'global' },
    {
      findOpportunitiesByUserId: async () => [opportunity],
      saveWrittenTestReviewForUser: async () => {
        saveCalled = true
        throw new Error('本测试不应写库')
      },
    },
  )
  const tool = registry.get('save_written_test_review')
  assert.ok(tool?.prepareInput)

  await assert.rejects(
    async () =>
      tool.prepareInput?.({ opportunityReference: 'Bilibili', reviewNote: '不应该保存。' }, undefined, {
        signal: new AbortController().signal,
      }),
    /未开启笔试流程/,
  )
  assert.equal(saveCalled, false)
})

test('全局面试复盘先消歧同名机会，再复用轮次选择和保存链路', async () => {
  const opportunities = [
    createOpportunity({
      id: '00000000-0000-4000-8000-000000000073',
      company: '小米',
      jobTitle: '前端工程师',
      status: 'interviewing',
    }),
    createOpportunity({
      id: '00000000-0000-4000-8000-000000000074',
      company: '小米',
      jobTitle: '前端工程师（商业化）',
      status: 'interviewing',
    }),
  ]
  const rounds = [
    {
      id: '00000000-0000-4000-8000-000000000075',
      type: 'technical_basic' as const,
      sequence: 1,
      title: '一面',
      scheduledAt: '2020-08-08T11:00:00.000Z',
      status: 'completed' as const,
      result: 'passed' as const,
      note: '',
      reviewNote: '',
      keyTakeaways: [],
      createdAt: '2020-08-08T00:00:00.000Z',
      updatedAt: '2020-08-08T12:00:00.000Z',
    },
    {
      id: '00000000-0000-4000-8000-000000000076',
      type: 'project' as const,
      sequence: 2,
      title: '项目面',
      scheduledAt: '2020-08-09T11:00:00.000Z',
      status: 'completed' as const,
      result: 'unknown' as const,
      note: '',
      reviewNote: '',
      keyTakeaways: [],
      createdAt: '2020-08-09T00:00:00.000Z',
      updatedAt: '2020-08-09T12:00:00.000Z',
    },
  ]
  const savedRecords: Array<Record<string, unknown>> = []
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'global' },
    {
      findOpportunitiesByUserId: async () => opportunities,
      findInterviewRoundsByOpportunityId: async (opportunityId) =>
        opportunityId === opportunities[1]!.id ? rounds : [],
      saveInterviewReviewForUser: async (record) => {
        savedRecords.push(record)
        return {
          round: {
            ...rounds[1]!,
            result: record.result,
            reviewNote: record.reviewNote,
          },
          alreadyApplied: false,
        }
      },
    },
  )
  const tool = registry.get('save_interview_review')
  assert.ok(tool?.prepareInput)

  const targetWaiting = await tool.prepareInput(
    { opportunityReference: '小米', reviewNote: '项目架构没有讲清楚。' },
    undefined,
    { signal: new AbortController().signal },
  )
  assert.equal(targetWaiting.status, 'waiting_input')
  if (targetWaiting.status !== 'waiting_input') throw new Error('同名机会应该先等待目标选择')
  assert.equal(targetWaiting.presentation.kind, 'opportunity_target_input')

  const roundWaiting = await tool.prepareInput(
    targetWaiting.input,
    { opportunityId: opportunities[1]!.id },
    { signal: new AbortController().signal },
  )
  assert.equal(roundWaiting.status, 'waiting_input')
  if (roundWaiting.status !== 'waiting_input') throw new Error('目标确定后应该继续选择面试轮次')
  assert.equal(roundWaiting.presentation.kind, 'review_input')
  assert.equal(roundWaiting.presentation.opportunityId, opportunities[1]!.id)
  assert.equal((roundWaiting.presentation.targetOptions as unknown[]).length, 2)

  const ready = await tool.prepareInput(
    roundWaiting.input,
    { roundId: rounds[1]!.id, result: 'failed' },
    { signal: new AbortController().signal },
  )
  assert.equal(ready.status, 'ready')
  if (ready.status !== 'ready') throw new Error('选择轮次后应该进入确认')

  const confirmation = await tool.prepareConfirmation?.(ready.input, { signal: new AbortController().signal })
  assert.equal(confirmation?.presentation.kind, 'review_save')
  assert.equal((confirmation?.presentation.target as { id?: unknown } | undefined)?.id, rounds[1]!.id)

  const output = await tool.execute(ready.input, {
    signal: new AbortController().signal,
    confirmationContext: confirmation?.executionContext,
  })
  assert.equal(output.status, 'saved')
  assert.equal(output.opportunityId, opportunities[1]!.id)
  assert.equal(savedRecords[0]?.roundId, rounds[1]!.id)
  assert.equal(savedRecords[0]?.result, 'failed')
  assert.equal(savedRecords[0]?.reviewNote, '项目架构没有讲清楚。')
})

test('search_opportunities 拒绝超过上限的返回数量', () => {
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'global' },
    { findOpportunitiesByUserId: async () => [] },
  )
  const tool = registry.get('search_opportunities')
  assert.ok(tool)

  const result = tool.inputValidator.safeParse({ statuses: [], intentionLevels: [], limit: 21 })
  assert.equal(result.success, false)
})

test('全局能力画像工具在多份简历无法唯一确定时持久化等待选择', async () => {
  const resumes: ResumeRecord[] = [
    {
      id: '00000000-0000-4000-8000-000000000201',
      userId: 'user-1',
      title: '前端开发主线',
      currentVersionId: '00000000-0000-4000-8000-000000000211',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-08T00:00:00.000Z',
    },
    {
      id: '00000000-0000-4000-8000-000000000202',
      userId: 'user-1',
      title: 'AI 应用开发主线',
      currentVersionId: '00000000-0000-4000-8000-000000000212',
      createdAt: '2026-08-02T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    },
  ]
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'global' },
    {
      findOpportunitiesByUserId: async () => [],
      findResumesByUserId: async () => resumes,
      getCapabilityProfileForUser: async () => {
        throw new Error('等待选择时不应该读取能力画像')
      },
    },
  )
  const tool = registry.get('get_capability_profile')
  assert.ok(tool?.prepareInput)
  assert.equal(tool.requiresConfirmation, false)

  const prepared = await tool.prepareInput({}, undefined, { signal: new AbortController().signal })
  assert.equal(prepared.status, 'waiting_input')
  if (prepared.status !== 'waiting_input') throw new Error('多份简历应等待用户选择')
  assert.equal(prepared.presentation.kind, 'resume_target_input')
  assert.equal((prepared.presentation.candidates as unknown[]).length, 2)
})

test('能力画像工具只信任用户选择的简历 ID，并限制返回证据数量', async () => {
  const resume: ResumeRecord = {
    id: '00000000-0000-4000-8000-000000000201',
    userId: 'user-1',
    title: '前端开发主线',
    currentVersionId: '00000000-0000-4000-8000-000000000211',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
  }
  const evidence = Array.from({ length: 7 }, (_, index) => ({
    capabilityKey: `capability-${index}`,
    label: `能力 ${index}`,
    evidenceCount: 7 - index,
    sourceCount: 1,
    confidence: 'high' as const,
    lastObservedAt: '2026-08-08T00:00:00.000Z',
    references: [{ type: 'interview_session' as const, id: `session-${index}` }],
  }))
  const profile: CapabilityProfile = {
    generatedAt: '2026-08-10T00:00:00.000Z',
    dataStatus: 'sufficient',
    scope: {
      resumeId: resume.id,
      resumeTitle: resume.title,
      currentVersionId: resume.currentVersionId,
      currentVersionNumber: 2,
      targetDirection: '前端开发',
    },
    resumeDeclaration: null,
    sourceCounts: {
      resumeDeclaration: 0,
      jdAnalyses: 0,
      completedJdAnalyses: 0,
      pendingJdAnalyses: 0,
      failedJdAnalyses: 0,
      simulatedSessions: 3,
    },
    jdOverview: {
      indexingStatus: 'ready',
      analyzedOpportunityCount: 0,
      indexedOpportunityCount: 0,
      strengthThemes: [],
      gapThemes: [],
    },
    jdSignals: [],
    interview: {
      strengths: evidence,
      weaknesses: evidence,
      historicalWeaknesses: [],
      sessions: [],
    },
  }
  const received: Array<{ userId: string; resumeId?: string }> = []
  const alternateResume: ResumeRecord = {
    ...resume,
    id: '00000000-0000-4000-8000-000000000202',
    title: 'AI 应用开发主线',
    currentVersionId: '00000000-0000-4000-8000-000000000212',
  }
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'global' },
    {
      findOpportunitiesByUserId: async () => [],
      findResumesByUserId: async () => [resume, alternateResume],
      getCapabilityProfileForUser: async (userId, resumeId) => {
        received.push({ userId, resumeId })
        return profile
      },
    },
  )
  const tool = registry.get('get_capability_profile')
  assert.ok(tool?.prepareInput)
  const prepared = await tool.prepareInput({}, { resumeId: resume.id }, { signal: new AbortController().signal })
  assert.equal(prepared.status, 'ready')
  if (prepared.status !== 'ready') throw new Error('唯一简历应该直接读取')

  const output = await tool.execute(prepared.input, { signal: new AbortController().signal })
  assert.deepEqual(received, [{ userId: 'user-1', resumeId: resume.id }])
  assert.equal((output.stableStrengths as unknown[]).length, 5)
  assert.equal((output.improvementAreas as unknown[]).length, 5)
})

test('没有简历时能力画像工具返回正常空结果，不把 Run 标记为失败', async () => {
  let serviceCalled = false
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'global' },
    {
      findOpportunitiesByUserId: async () => [],
      findResumesByUserId: async () => [],
      getCapabilityProfileForUser: async () => {
        serviceCalled = true
        throw new Error('空数据不应该继续读取画像聚合服务')
      },
    },
  )
  const tool = registry.get('get_capability_profile')
  assert.ok(tool?.prepareInput)
  const prepared = await tool.prepareInput({}, undefined, { signal: new AbortController().signal })
  assert.equal(prepared.status, 'ready')
  if (prepared.status !== 'ready') throw new Error('无简历应该进入正常空结果')

  const output = await tool.execute(prepared.input, { signal: new AbortController().signal })
  assert.equal(output.status, 'empty')
  assert.equal(serviceCalled, false)
})

test('行动策略工具读取现有快照且限制返回的行动数量', async () => {
  const action = (index: number) => ({
    key: `action-${index}`,
    type: 'follow_up' as const,
    priority: 'high' as const,
    title: `跟进机会 ${index}`,
    reason: '距离上次进展较久',
    suggestedStep: '礼貌询问后续安排',
    evidence: ['上次进展距今 5 天'],
    opportunityId: `opportunity-${index}`,
    company: `公司 ${index}`,
    jobTitle: '前端开发',
    status: 'interviewing' as const,
    intentionLevel: 'A' as const,
    waitingStage: 'follow_up' as const,
    cta: { label: '查看机会', to: `/opportunity/${index}` },
  })
  const overview: ActionStrategyOverview = {
    generatedAt: '2026-08-10T00:00:00.000Z',
    currentFingerprint: 'fingerprint',
    sourceSummary: {
      opportunityCount: 12,
      upcomingEventCount: 1,
      stalledOpportunityCount: 2,
      completedAnalysisCount: 4,
      capabilityEvidenceCount: 3,
    },
    actions: Array.from({ length: 12 }, (_, index) => action(index)),
    capabilityActions: [],
    ai: {
      freshness: 'stale',
      status: 'completed',
      snapshotId: 'snapshot-1',
      modelName: 'deepseek-v4-pro',
      generatedAt: '2026-08-08T00:00:00.000Z',
      expiresAt: '2026-08-11T00:00:00.000Z',
      staleReasons: ['source_changed'],
      summary: null,
      error: null,
    },
  }
  let receivedUserId = ''
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'global' },
    {
      findOpportunitiesByUserId: async () => [],
      getActionStrategyOverviewForUser: async (userId) => {
        receivedUserId = userId
        return overview
      },
    },
  )
  const tool = registry.get('get_action_strategy')
  assert.ok(tool)
  assert.equal(tool.requiresConfirmation, false)

  const output = await tool.execute({}, { signal: new AbortController().signal })
  assert.equal(receivedUserId, 'user-1')
  assert.equal((output.actions as unknown[]).length, 10)
  assert.equal((output.ai as { freshness?: unknown }).freshness, 'stale')
})

test('机会内会话不暴露跨机会能力画像和行动策略工具', () => {
  const opportunity = createOpportunity({
    id: '00000000-0000-4000-8000-000000000221',
    company: '微派',
    jobTitle: '前端开发',
  })
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'opportunity', opportunity },
    {
      findOpportunitiesByUserId: async () => [opportunity],
      findResumesByUserId: async () => [],
      getCapabilityProfileForUser: async () => {
        throw new Error('不应该执行')
      },
      getActionStrategyOverviewForUser: async () => {
        throw new Error('不应该执行')
      },
      updateOpportunityProfileForUser: async () => ({ opportunity, alreadyApplied: false }),
      transitionOpportunityStatusForUser: async () => ({ opportunity, alreadyApplied: false }),
    },
  )

  assert.equal(registry.get('get_capability_profile'), undefined)
  assert.equal(registry.get('get_action_strategy'), undefined)
})

test('机会内终止工具先展示可编辑原因卡片，提交后才写入', async () => {
  const opportunity = createOpportunity({
    id: '00000000-0000-4000-8000-000000000401',
    company: '百度',
    jobTitle: '前端工程师',
    status: 'applied',
  })
  let received: Record<string, unknown> | null = null
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'opportunity', opportunity },
    {
      findOpportunitiesByUserId: async () => [opportunity],
      updateOpportunityProfileForUser: async () => ({ opportunity, alreadyApplied: false }),
      transitionOpportunityStatusForUser: async () => ({ opportunity, alreadyApplied: false }),
      terminateOpportunityForUser: async (record) => {
        received = record
        return { opportunity: { ...opportunity, status: 'closed' }, alreadyApplied: false }
      },
    },
  )
  const tool = registry.get('terminate_opportunity')
  assert.ok(tool?.prepareInput)
  assert.equal(tool.requiresConfirmation, false)

  const waiting = await tool.prepareInput({ reasonNote: '薪资不匹配' }, undefined, {
    signal: new AbortController().signal,
  })
  assert.equal(waiting.status, 'waiting_input')
  if (waiting.status !== 'waiting_input') return
  assert.equal(waiting.presentation.kind, 'opportunity_termination_input')
  assert.equal((waiting.presentation.values as { reasonNote: string }).reasonNote, '薪资不匹配')

  const ready = await tool.prepareInput(
    waiting.input,
    { reasonNote: '已接受其他 offer' },
    { signal: new AbortController().signal },
  )
  assert.equal(ready.status, 'ready')
  if (ready.status !== 'ready') return
  const output = await tool.execute(ready.input, { signal: new AbortController().signal })

  assert.deepEqual(received, {
    opportunityId: opportunity.id,
    userId: 'user-1',
    expectedStatus: 'applied',
    reasonNote: '已接受其他 offer',
  })
  assert.equal(output.status, 'terminated')
  assert.equal(output.reasonNote, '已接受其他 offer')
})

test('全局终止工具在同名机会中先选目标，再单独确认终止原因', async () => {
  const first = createOpportunity({
    id: '00000000-0000-4000-8000-000000000411',
    company: '百度',
    jobTitle: '前端工程师',
    status: 'applied',
  })
  const second = createOpportunity({
    id: '00000000-0000-4000-8000-000000000412',
    company: '百度',
    jobTitle: '高级前端工程师',
    status: 'interviewing',
  })
  const registry = createChatToolRegistry(
    { userId: 'user-1', scopeType: 'global' },
    {
      findOpportunitiesByUserId: async () => [first, second],
      terminateOpportunityForUser: async () => ({
        opportunity: { ...second, status: 'closed' },
        alreadyApplied: false,
      }),
    },
  )
  const tool = registry.get('terminate_opportunity')
  assert.ok(tool?.prepareInput)

  const targetWaiting = await tool.prepareInput({ opportunityReference: '百度' }, undefined, {
    signal: new AbortController().signal,
  })
  assert.equal(targetWaiting.status, 'waiting_input')
  if (targetWaiting.status !== 'waiting_input') return
  assert.equal(targetWaiting.presentation.kind, 'opportunity_target_input')

  const reasonWaiting = await tool.prepareInput(
    targetWaiting.input,
    { opportunityId: second.id },
    { signal: new AbortController().signal },
  )
  assert.equal(reasonWaiting.status, 'waiting_input')
  if (reasonWaiting.status !== 'waiting_input') return
  assert.equal(reasonWaiting.presentation.kind, 'opportunity_termination_input')

  const ready = await tool.prepareInput(
    reasonWaiting.input,
    { reasonNote: '' },
    { signal: new AbortController().signal },
  )
  assert.equal(ready.status, 'ready')
  if (ready.status !== 'ready') return
  assert.equal(ready.input.opportunityId, second.id)
  assert.equal(ready.input.reasonNote, '')
})
