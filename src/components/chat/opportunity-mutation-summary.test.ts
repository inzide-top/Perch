import assert from 'node:assert/strict'
import test from 'node:test'
import { groupOpportunityMutationParts, type OpportunityMutationSummaryItem } from './opportunity-mutation-summary'

type TestPart = { type: 'text'; text: string } | { type: 'mutation'; id: string; status: 'completed' | 'waiting' }

function toSummaryItem(part: TestPart): OpportunityMutationSummaryItem | null {
  if (part.type !== 'mutation' || part.status !== 'completed') return null
  return {
    toolActionId: part.id,
    opportunityId: part.id,
    company: '美团',
    jobTitle: '前端工程师',
    operationLabel: '终止流程',
    status: 'completed',
    changes: [{ label: '阶段', before: '已投递', after: '已终止' }],
    errorMessage: null,
  }
}

test('相邻的多个已结束机会操作会收敛成一个汇总结果', () => {
  const grouped = groupOpportunityMutationParts<TestPart>(
    [
      { type: 'text', text: '处理结果如下' },
      { type: 'mutation', id: 'one', status: 'completed' },
      { type: 'mutation', id: 'two', status: 'completed' },
    ],
    toSummaryItem,
  )

  assert.equal(grouped.length, 2)
  assert.equal(grouped[1]?.type, 'summary')
  if (grouped[1]?.type !== 'summary') return
  assert.deepEqual(
    grouped[1].part.items.map((item) => item.toolActionId),
    ['one', 'two'],
  )
})

test('单个结果和等待用户确认的卡片都保持原样', () => {
  const grouped = groupOpportunityMutationParts<TestPart>(
    [
      { type: 'mutation', id: 'one', status: 'completed' },
      { type: 'mutation', id: 'waiting', status: 'waiting' },
    ],
    toSummaryItem,
  )

  assert.deepEqual(
    grouped.map((item) => item.type),
    ['original', 'original'],
  )
})
