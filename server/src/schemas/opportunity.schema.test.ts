import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addInterviewRoundInputSchema,
  batchDeleteJobOpportunitiesInputSchema,
  completeInterviewRoundInputSchema,
  updateInterviewRoundInputSchema,
  updateJobOpportunityInputSchema,
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

test('批量删除会去重机会 ID，并限制一次最多处理 50 条', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const parsed = batchDeleteJobOpportunitiesInputSchema.parse({ opportunityIds: [id, id] })
  assert.deepEqual(parsed.opportunityIds, [id])

  const tooManyIds = Array.from(
    { length: 51 },
    (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  )
  assert.equal(batchDeleteJobOpportunitiesInputSchema.safeParse({ opportunityIds: tooManyIds }).success, false)
})

test('机会编辑接口用 null 表示清空意向等级', () => {
  assert.deepEqual(updateJobOpportunityInputSchema.parse({ intentionLevel: null }), { intentionLevel: null })
  assert.equal(updateJobOpportunityInputSchema.safeParse({ intentionLevel: '' }).success, false)
})
