import assert from 'node:assert/strict'
import test from 'node:test'
process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test'

import type { AgentRunDebugEntry } from './agent-run-debug'
import { toAgentRunDebugItem } from './agent-run-debug'
import { runWithCurrentUser } from '../context/current-user'

const { AgentRunNotFoundError, getAgentRunDebugDetail, getAgentRunDebugList } = await import('./agent-run.service')

function createEntry(overrides: Partial<AgentRunDebugEntry> = {}): AgentRunDebugEntry {
  return {
    run: {
      id: '00000000-0000-4000-8000-000000000001',
      workflowType: 'job_analysis',
      analysisId: '00000000-0000-4000-8000-000000000002',
      interviewSessionId: null,
      interviewTurnId: null,
      chatRunId: null,
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
    resumePdfImportTaskId: null,
    resumePdfFileName: null,
    resumePdfImportStatus: null,
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

test('PDF 简历识别调试记录保留任务和文件上下文', () => {
  const entry = createEntry()
  const item = toAgentRunDebugItem(
    createEntry({
      run: {
        ...entry.run,
        workflowType: 'resume_pdf_import',
        analysisId: null,
        operationKey: 'resume_pdf_import:00000000-0000-4000-8000-000000000006',
      },
      opportunityId: null,
      company: null,
      jobTitle: null,
      resumePdfImportTaskId: '00000000-0000-4000-8000-000000000006',
      resumePdfFileName: '张晨-前端工程师.pdf',
      resumePdfImportStatus: 'processing',
    }),
  )

  assert.equal(item.workflowType, 'resume_pdf_import')
  assert.equal(item.resumePdfImportTaskId, '00000000-0000-4000-8000-000000000006')
  assert.equal(item.resumePdfFileName, '张晨-前端工程师.pdf')
  assert.equal(item.resumePdfImportStatus, 'processing')
})

test('Agent Run 列表把当前认证用户传入持久层', async () => {
  let capturedUserId: string | null = null

  await runWithCurrentUser({ userId: 'user-a', email: 'a@example.com', authMode: 'supabase' }, async () => {
    const result = await getAgentRunDebugList(
      { limit: 20 },
      {
        async findDebugList(filters) {
          capturedUserId = filters.userId
          return []
        },
      },
    )

    assert.deepEqual(result, [])
  })

  assert.equal(capturedUserId, 'user-a')
})

test('Agent Run 详情只按当前认证用户读取，不暴露其他用户记录', async () => {
  let capturedLookup: { runId: string; userId: string } | null = null

  await assert.rejects(
    runWithCurrentUser({ userId: 'user-b', email: 'b@example.com', authMode: 'supabase' }, () =>
      getAgentRunDebugDetail('00000000-0000-4000-8000-000000000009', {
        async findDebugById(runId, userId) {
          capturedLookup = { runId, userId }
          return null
        },
      }),
    ),
    AgentRunNotFoundError,
  )

  assert.deepEqual(capturedLookup, {
    runId: '00000000-0000-4000-8000-000000000009',
    userId: 'user-b',
  })
})
