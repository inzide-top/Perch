import test from 'node:test'
import assert from 'node:assert/strict'
import { backgroundTaskStatusInputSchema } from './background-task.schema'

test('后台任务状态请求支持 JD 分析、深度点评和行动策略的混合批次', () => {
  const input = {
    tasks: [
      { type: 'job_analysis', opportunityId: '11111111-1111-4111-8111-111111111111' },
      {
        type: 'answer_deep_evaluation',
        sessionId: '22222222-2222-4222-8222-222222222222',
        turnId: '33333333-3333-4333-8333-333333333333',
      },
      { type: 'action_strategy', snapshotId: '44444444-4444-4444-8444-444444444444' },
    ],
  }

  assert.deepEqual(backgroundTaskStatusInputSchema.parse(input), input)
})

test('后台任务状态请求拒绝未知任务类型和空批次', () => {
  assert.throws(() => backgroundTaskStatusInputSchema.parse({ tasks: [] }))
  assert.throws(() =>
    backgroundTaskStatusInputSchema.parse({
      tasks: [{ type: 'unknown', opportunityId: '11111111-1111-4111-8111-111111111111' }],
    }),
  )
})
