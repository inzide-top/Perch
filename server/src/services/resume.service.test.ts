import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeResumeInterviewHistoryConflict } from './resume/deletion-conflict'

test('summarizes archived and unarchived interview references separately', () => {
  const result = summarizeResumeInterviewHistoryConflict([
    { archivedAt: '2026-08-14T08:00:00.000Z' },
    { archivedAt: null },
    { archivedAt: '2026-08-14T09:00:00.000Z' },
  ])

  assert.deepEqual(result, {
    archivedSessionCount: 2,
    unarchivedSessionCount: 1,
  })
})

test('does not report an archived dependency for active-only interview references', () => {
  const result = summarizeResumeInterviewHistoryConflict([{ archivedAt: null }, { archivedAt: null }])

  assert.deepEqual(result, {
    archivedSessionCount: 0,
    unarchivedSessionCount: 2,
  })
})
