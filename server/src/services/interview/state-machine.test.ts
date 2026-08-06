import assert from 'node:assert/strict'
import test from 'node:test'
import { getInterviewCancellationOperationKeys, getInterviewSubmissionReplay } from './state-machine'

test('同一回答在 Session 已推进后重放时仍命中幂等恢复', () => {
  assert.equal(
    getInterviewSubmissionReplay({
      sessionId: 'session-1',
      turnId: 'turn-1',
      existingAnswerTurn: { id: 'turn-1', sessionId: 'session-1' },
      existingInteraction: null,
    }),
    'same_operation',
  )

  assert.equal(
    getInterviewSubmissionReplay({
      sessionId: 'session-1',
      turnId: 'turn-1',
      existingAnswerTurn: null,
      existingInteraction: { turnId: 'turn-1' },
    }),
    'same_operation',
  )
})

test('客户端提交标识不能跨 Session 或跨 Turn 复用', () => {
  assert.equal(
    getInterviewSubmissionReplay({
      sessionId: 'session-1',
      turnId: 'turn-1',
      existingAnswerTurn: { id: 'turn-2', sessionId: 'session-1' },
      existingInteraction: null,
    }),
    'conflict',
  )

  assert.equal(
    getInterviewSubmissionReplay({
      sessionId: 'session-1',
      turnId: 'turn-1',
      existingAnswerTurn: null,
      existingInteraction: { turnId: 'turn-2' },
    }),
    'conflict',
  )
})

test('结束面试会覆盖计划、跳过和当前回答三类活动模型任务', () => {
  assert.deepEqual(
    getInterviewCancellationOperationKeys('session-1', {
      id: 'turn-1',
      answerSubmissionKey: 'submission-1',
    }),
    ['interview_plan:session-1', 'interview_skip:turn-1', 'interview_turn:turn-1:submission-1'],
  )
})
