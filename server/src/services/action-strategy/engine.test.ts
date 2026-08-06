import assert from 'node:assert/strict'
import test from 'node:test'
import { buildActionStrategy, countBusinessDaysBetween } from './engine'
import type { StrategyOpportunityContext } from './types'

function opportunity(overrides: Partial<StrategyOpportunityContext> = {}): StrategyOpportunityContext {
  return {
    id: 'opportunity-1',
    company: '示例公司',
    jobTitle: '前端工程师',
    status: 'pending_apply',
    intentionLevel: 'A',
    updatedAt: '2026-08-03T09:00:00.000Z',
    writtenTestScheduledAt: null,
    writtenTestReviewedAt: null,
    analysis: { status: 'completed', matchScore: 75, resumeVersionId: null },
    statusHistory: [],
    interviewRounds: [],
    ...overrides,
  }
}

test('counts weekdays without treating weekends as waiting days', () => {
  assert.equal(countBusinessDaysBetween('2026-08-07T09:00:00.000Z', '2026-08-10T09:00:00.000Z'), 1)
})

test('creates a submit action for a high-intention, sufficiently matched pending opportunity', () => {
  const result = buildActionStrategy({ opportunities: [opportunity()], now: new Date('2026-08-06T09:00:00.000Z') })
  assert.equal(
    result.actions.some((action) => action.type === 'submit_application'),
    true,
  )
  assert.equal(result.currentFingerprint.length, 64)
})

test('creates a follow-up action after four business days of silence', () => {
  const result = buildActionStrategy({
    opportunities: [
      opportunity({
        status: 'interviewing',
        statusHistory: [{ toStatus: 'interviewing', createdAt: '2026-07-31T09:00:00.000Z' }],
      }),
    ],
    now: new Date('2026-08-06T09:00:00.000Z'),
  })
  assert.equal(
    result.actions.some((action) => action.type === 'follow_up'),
    true,
  )
})

test('creates an urgent preparation action for an upcoming planned interview', () => {
  const result = buildActionStrategy({
    opportunities: [
      opportunity({
        status: 'interviewing',
        interviewRounds: [
          {
            id: 'round-1',
            title: '技术面',
            scheduledAt: '2026-08-07T09:00:00.000Z',
            status: 'planned',
            result: 'pending',
            updatedAt: '2026-08-01T09:00:00.000Z',
          },
        ],
      }),
    ],
    now: new Date('2026-08-06T09:00:00.000Z'),
  })
  assert.equal(result.actions.find((action) => action.type === 'prepare_interview')?.priority, 'urgent')
})

test('turns historical weakness into a capability action without changing opportunity actions', () => {
  const result = buildActionStrategy({
    opportunities: [],
    historicalWeaknesses: [
      {
        topicKey: 'frontend_core',
        topicLabel: '前端基础',
        summary: '多次回答暴露基础薄弱',
        masteryScore: 42,
        confidence: 'high',
        lastObservedAt: '2026-08-01T09:00:00.000Z',
      },
    ],
  })
  assert.equal(result.capabilityActions[0]?.capabilityKey, 'frontend_core')
  assert.equal(result.runInput.actionCandidates.length, 0)
})

test('fingerprint is stable for the same deterministic input and changes when evidence changes', () => {
  const first = buildActionStrategy({ opportunities: [opportunity()] })
  const same = buildActionStrategy({ opportunities: [opportunity()] })
  const changed = buildActionStrategy({ opportunities: [opportunity({ intentionLevel: 'S' })] })
  assert.equal(first.currentFingerprint, same.currentFingerprint)
  assert.notEqual(first.currentFingerprint, changed.currentFingerprint)
})
