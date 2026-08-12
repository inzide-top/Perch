import assert from 'node:assert/strict'
import test from 'node:test'
import type { JobOpportunityStatus, OpportunityStatusChange } from '@/types/opportunity'
import { getHighestReachedStatusIndex } from './reviewAvailability'

const statusFlow = [
  { value: 'pending_apply' },
  { value: 'applied' },
  { value: 'written_test' },
  { value: 'interviewing' },
  { value: 'oc' },
  { value: 'offered' },
] satisfies Array<{ value: JobOpportunityStatus }>

test('已终止机会仍能从倒序状态历史判断曾经进入过面试阶段', () => {
  const histories: OpportunityStatusChange[] = [
    {
      id: 'closed',
      fromStatus: 'interviewing',
      toStatus: 'closed',
      trigger: 'user',
      createdAt: '2026-08-18T10:00:00.000Z',
    },
    {
      id: 'interviewing',
      fromStatus: 'applied',
      toStatus: 'interviewing',
      trigger: 'user',
      createdAt: '2026-08-17T10:00:00.000Z',
    },
    {
      id: 'created',
      fromStatus: null,
      toStatus: 'pending_apply',
      trigger: 'system',
      createdAt: '2026-08-16T10:00:00.000Z',
    },
  ]

  assert.equal(getHighestReachedStatusIndex(statusFlow, 'closed', histories), 3)
})

test('阶段回退后终止仍保留曾经到达过的最深阶段', () => {
  const histories: OpportunityStatusChange[] = [
    {
      id: 'closed',
      fromStatus: 'applied',
      toStatus: 'closed',
      trigger: 'user',
      createdAt: '2026-08-18T10:00:00.000Z',
    },
    {
      id: 'rollback',
      fromStatus: 'interviewing',
      toStatus: 'applied',
      trigger: 'user',
      createdAt: '2026-08-17T10:00:00.000Z',
    },
  ]

  assert.equal(getHighestReachedStatusIndex(statusFlow, 'closed', histories), 3)
})
