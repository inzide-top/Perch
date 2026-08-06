import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canApplyInterviewSessionResponse,
  getInterviewPollDelay,
  interviewBackgroundPollDelayMs,
  interviewForegroundPollDelayMs,
  isSameModelIdentity,
  shouldDeferInterviewScoreUpdate,
} from '@/services/interview-runtime'

test('页面隐藏时轮询降为 30 秒，恢复可见后回到前台间隔', () => {
  assert.equal(getInterviewPollDelay('hidden'), interviewBackgroundPollDelayMs)
  assert.equal(getInterviewPollDelay('visible'), interviewForegroundPollDelayMs)
})

test('取消或新请求递增 generation 后，旧响应不能覆盖当前 Session', () => {
  assert.equal(canApplyInterviewSessionResponse(3, 3), true)
  assert.equal(canApplyInterviewSessionResponse(2, 3), false)
})

test('模型身份比较会归一化 Base URL 尾斜杠，但不会忽略模型名差异', () => {
  assert.equal(
    isSameModelIdentity(
      { baseUrl: 'HTTPS://API.DEEPSEEK.COM/', modelName: 'deepseek-chat' },
      { baseUrl: 'https://api.deepseek.com', modelName: 'deepseek-chat' },
    ),
    true,
  )
  assert.equal(
    isSameModelIdentity(
      { baseUrl: 'https://api.deepseek.com', modelName: 'deepseek-chat' },
      { baseUrl: 'https://api.deepseek.com', modelName: 'deepseek-reasoner' },
    ),
    false,
  )
})

test('新问题尚未到达时延迟更新评分，问题到达后可与模拟流式同步更新', () => {
  const previous = {
    status: 'active',
    phase: 'evaluating_answer',
    currentQuestionId: 'turn-1',
    questions: [{ id: 'turn-1' }],
    interactions: [],
  }

  assert.equal(
    shouldDeferInterviewScoreUpdate(previous, {
      ...previous,
      phase: 'generating_question',
    }),
    true,
  )
  assert.equal(
    shouldDeferInterviewScoreUpdate(previous, {
      ...previous,
      phase: 'awaiting_answer',
      currentQuestionId: 'turn-2',
      questions: [...previous.questions, { id: 'turn-2' }],
    }),
    false,
  )
})
