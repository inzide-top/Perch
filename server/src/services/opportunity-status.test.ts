import assert from 'node:assert/strict'
import test from 'node:test'
import { isAllowedStatusTransition } from './opportunity-status'

test('机会状态允许向前跨级和向后回退', () => {
  assert.equal(isAllowedStatusTransition('pending_apply', 'interviewing', false), true)
  assert.equal(isAllowedStatusTransition('oc', 'applied', false), true)
  assert.equal(isAllowedStatusTransition('interviewing', 'interviewing', false), true)
})

test('未开启笔试流程时不能进入笔试中', () => {
  assert.equal(isAllowedStatusTransition('applied', 'written_test', false), false)
  assert.equal(isAllowedStatusTransition('applied', 'written_test', true), true)
})
