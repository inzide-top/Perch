import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveActionStrategyFreshness } from './freshness'

const currentFingerprint = 'current-fingerprint'
const completedAt = '2026-08-07T08:00:00.000Z'

test('keeps a completed current strategy fresh before 72 hours', () => {
  const result = resolveActionStrategyFreshness({
    hasSourceData: true,
    snapshotStatus: 'completed',
    snapshotFingerprint: currentFingerprint,
    currentFingerprint,
    completedAt,
    now: new Date('2026-08-10T07:59:59.999Z'),
  })

  assert.equal(result.freshness, 'fresh')
  assert.deepEqual(result.staleReasons, [])
  assert.equal(result.expiresAt, '2026-08-10T08:00:00.000Z')
})

test('marks a strategy stale when its completed snapshot reaches 72 hours', () => {
  const result = resolveActionStrategyFreshness({
    hasSourceData: true,
    snapshotStatus: 'completed',
    snapshotFingerprint: currentFingerprint,
    currentFingerprint,
    completedAt,
    now: new Date('2026-08-10T08:00:00.000Z'),
  })

  assert.equal(result.freshness, 'stale')
  assert.deepEqual(result.staleReasons, ['time_expired'])
})

test('marks a completed strategy stale immediately when source data changes', () => {
  const result = resolveActionStrategyFreshness({
    hasSourceData: true,
    snapshotStatus: 'completed',
    snapshotFingerprint: 'old-fingerprint',
    currentFingerprint,
    completedAt: '2026-08-10T07:30:00.000Z',
    now: new Date('2026-08-10T08:00:00.000Z'),
  })

  assert.equal(result.freshness, 'stale')
  assert.deepEqual(result.staleReasons, ['source_changed'])
})

test('keeps both stale reasons when data changed and the snapshot is also too old', () => {
  const result = resolveActionStrategyFreshness({
    hasSourceData: true,
    snapshotStatus: 'completed',
    snapshotFingerprint: 'old-fingerprint',
    currentFingerprint,
    completedAt,
    now: new Date('2026-08-10T08:00:00.000Z'),
  })

  assert.equal(result.freshness, 'stale')
  assert.deepEqual(result.staleReasons, ['source_changed', 'time_expired'])
})

test('keeps current pending and failed snapshots in their lifecycle states', () => {
  const pending = resolveActionStrategyFreshness({
    hasSourceData: true,
    snapshotStatus: 'pending',
    snapshotFingerprint: currentFingerprint,
    currentFingerprint,
    completedAt: null,
    now: new Date('2026-08-10T08:00:00.000Z'),
  })
  const failed = resolveActionStrategyFreshness({
    hasSourceData: true,
    snapshotStatus: 'failed',
    snapshotFingerprint: currentFingerprint,
    currentFingerprint,
    completedAt: null,
    now: new Date('2026-08-10T08:00:00.000Z'),
  })

  assert.equal(pending.freshness, 'generating')
  assert.equal(failed.freshness, 'failed')
})

test('ignores an old snapshot when there is no current strategy source data', () => {
  const result = resolveActionStrategyFreshness({
    hasSourceData: false,
    snapshotStatus: 'completed',
    snapshotFingerprint: 'old-fingerprint',
    currentFingerprint,
    completedAt,
    now: new Date('2026-08-10T08:00:00.000Z'),
  })

  assert.equal(result.freshness, 'not_generated')
  assert.deepEqual(result.staleReasons, [])
  assert.equal(result.expiresAt, null)
})
