import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentRunDebugEntry } from './agent-run-debug'
import { toAgentRunDebugItem } from './agent-run-debug'

function createEntry(overrides: Partial<AgentRunDebugEntry> = {}): AgentRunDebugEntry {
  return {
    run: {
      id: '00000000-0000-4000-8000-000000000001',
      workflowType: 'job_analysis',
      analysisId: '00000000-0000-4000-8000-000000000002',
      interviewSessionId: null,
      interviewTurnId: null,
      reviewDocumentId: null,
      operationKey: 'job_analysis:00000000-0000-4000-8000-000000000002',
      attemptNumber: 1,
      status: 'completed',
      modelName: 'test-model',
      promptVersion: 'v1',
      input: {},
      rawOutput: '{}',
      parsedOutput: {},
      error: null,
      durationMs: 100,
      tokenUsage: null,
      startedAt: '2026-08-03T00:00:00.000Z',
      finishedAt: '2026-08-03T00:00:00.100Z',
    },
    sourceAnalysisId: null,
    opportunityId: '00000000-0000-4000-8000-000000000003',
    company: 'Bilibili',
    jobTitle: 'AI Native 开发工程师',
    turnSequenceNumber: null,
    mainQuestionNumber: null,
    reviewDocumentId: null,
    reviewSourceType: null,
    reviewDocumentStatus: null,
    ...overrides,
  }
}

test('JD 分析调试记录保留 Analysis 上下文', () => {
  const item = toAgentRunDebugItem(createEntry())

  assert.equal(item.workflowType, 'job_analysis')
  assert.equal(item.analysisId, '00000000-0000-4000-8000-000000000002')
  assert.equal(item.interviewSessionId, null)
  assert.equal('input' in item, false)
  assert.equal('rawOutput' in item, false)
  assert.equal('parsedOutput' in item, false)
})

test('模拟面试回答调试记录保留 Session、Turn 和题次上下文', () => {
  const entry = createEntry()
  const item = toAgentRunDebugItem(
    createEntry({
      run: {
        ...entry.run,
        workflowType: 'interview_turn',
        analysisId: null,
        interviewSessionId: '00000000-0000-4000-8000-000000000004',
        interviewTurnId: '00000000-0000-4000-8000-000000000005',
        operationKey: 'interview_turn:00000000-0000-4000-8000-000000000005',
      },
      turnSequenceNumber: 3,
      mainQuestionNumber: 2,
    }),
  )

  assert.equal(item.workflowType, 'interview_turn')
  assert.equal(item.analysisId, null)
  assert.equal(item.interviewSessionId, '00000000-0000-4000-8000-000000000004')
  assert.equal(item.interviewTurnId, '00000000-0000-4000-8000-000000000005')
  assert.equal(item.turnSequenceNumber, 3)
  assert.equal(item.mainQuestionNumber, 2)
})
