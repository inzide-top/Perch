import assert from 'node:assert/strict'
import test from 'node:test'
import type { OpportunityListFilters } from '@/services/opportunities'
import {
  clearOpportunityListFilters,
  consumeOpportunityListFilters,
  rememberOpportunityListFilters,
} from './opportunity-list-navigation-state'

test('机会列表返回快照只消费一次，并与原筛选对象隔离', () => {
  clearOpportunityListFilters()
  const source: OpportunityListFilters = {
    statuses: ['interviewing'],
    intentionLevels: ['A'],
    recommendations: ['worth_trying'],
    regions: ['east_china'],
  }

  rememberOpportunityListFilters(source)
  const restored = consumeOpportunityListFilters()

  assert.deepEqual(restored, source)
  assert.equal(consumeOpportunityListFilters(), null)
})

test('离开机会详情导航链路后可以主动丢弃返回快照', () => {
  rememberOpportunityListFilters({ statuses: ['applied'] })
  clearOpportunityListFilters()

  assert.equal(consumeOpportunityListFilters(), null)
})
