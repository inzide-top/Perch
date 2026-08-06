import assert from 'node:assert/strict'
import test from 'node:test'
import { parseActionStrategyModelOutput } from './action-strategy.schema'
import type { ActionStrategyRunInput } from '../services/action-strategy/types'

const input: ActionStrategyRunInput = {
  generatedAt: '2026-08-06T00:00:00.000Z',
  sourceSummary: {
    opportunityCount: 1,
    upcomingEventCount: 1,
    stalledOpportunityCount: 0,
    completedAnalysisCount: 1,
    capabilityEvidenceCount: 1,
  },
  actionCandidates: [
    {
      key: 'A1',
      type: 'prepare_interview',
      priority: 'urgent',
      company: '示例公司',
      jobTitle: '前端工程师',
      status: 'interviewing',
      intentionLevel: 'A',
      matchScore: 80,
      waitingStage: null,
      facts: ['面试将在 1 天内开始'],
    },
  ],
  capabilityCandidates: [
    {
      key: 'C1',
      capabilityKey: 'frontend_core',
      label: '前端基础',
      confidence: 'medium',
      evidenceCount: 2,
      sourceLabel: '历史薄弱项',
    },
  ],
}

test('action strategy output can only reference deterministic candidates', () => {
  const output = parseActionStrategyModelOutput(
    JSON.stringify({
      headline: '先准备面试',
      summary: '当前有一条即将开始的面试，建议优先准备。',
      selectedActions: [{ actionKey: 'A1', reason: '时间紧近。', suggestedStep: '查看机会详情。' }],
      capabilityFocus: [{ actionKey: 'C1', reason: '历史证据显示需要继续验证。' }],
    }),
    input,
  )
  assert.equal(output.selectedActions[0]?.actionKey, 'A1')
})

test('action strategy output rejects missing urgent actions and unknown keys', () => {
  assert.throws(
    () =>
      parseActionStrategyModelOutput(
        JSON.stringify({
          headline: '不完整',
          summary: '没有引用紧急行动。',
          selectedActions: [{ actionKey: 'A9', reason: '不存在。', suggestedStep: '不存在。' }],
          capabilityFocus: [],
        }),
        input,
      ),
    /不属于当前候选行动/,
  )

  assert.throws(
    () =>
      parseActionStrategyModelOutput(
        JSON.stringify({
          headline: '不完整',
          summary: '遗漏紧急行动。',
          selectedActions: [],
          capabilityFocus: [],
        }),
        input,
      ),
    /必须保留所有 urgent 行动/,
  )
})
