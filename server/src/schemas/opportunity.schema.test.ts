import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addInterviewRoundInputSchema,
  completeInterviewRoundInputSchema,
  updateInterviewRoundInputSchema,
} from './opportunity.schema'

const baseRound = {
  type: 'technical_basic' as const,
  title: '技术一面',
  scheduledAt: '2026-08-08',
}

test('待进行轮次只能使用 pending 结果', () => {
  const result = addInterviewRoundInputSchema.safeParse({
    ...baseRound,
    status: 'planned',
    result: 'passed',
  })

  assert.equal(result.success, false)
})

test('已完成轮次不能继续使用 pending 结果', () => {
  const result = addInterviewRoundInputSchema.safeParse({
    ...baseRound,
    status: 'completed',
    result: 'pending',
  })

  assert.equal(result.success, false)
})

test('普通编辑接口不允许顺便流转轮次状态', () => {
  const result = updateInterviewRoundInputSchema.safeParse({ status: 'completed' })

  assert.equal(result.success, false)
})

test('完成动作只接受已完成后的结果值', () => {
  assert.equal(completeInterviewRoundInputSchema.safeParse({ result: 'unknown' }).success, true)
  assert.equal(completeInterviewRoundInputSchema.safeParse({ result: 'pending' }).success, false)
})
