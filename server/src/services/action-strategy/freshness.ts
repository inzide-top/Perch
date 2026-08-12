import type {
  ActionStrategyFreshness,
  ActionStrategySnapshotStatus,
  ActionStrategyStaleReason,
} from '@/types/action-strategy'

export const actionStrategyMaxAgeMs = 72 * 60 * 60 * 1_000

export type ActionStrategyFreshnessResult = {
  freshness: ActionStrategyFreshness
  staleReasons: ActionStrategyStaleReason[]
  expiresAt: string | null
}

export function resolveActionStrategyFreshness(input: {
  hasSourceData: boolean
  snapshotStatus: ActionStrategySnapshotStatus | null
  snapshotFingerprint: string | null
  currentFingerprint: string
  completedAt: string | null
  now: Date
}): ActionStrategyFreshnessResult {
  if (!input.hasSourceData) {
    return { freshness: 'not_generated', staleReasons: [], expiresAt: null }
  }

  const isCurrent = input.snapshotFingerprint === input.currentFingerprint
  const completedAtMs = input.completedAt ? Date.parse(input.completedAt) : Number.NaN
  const expiresAtMs = Number.isFinite(completedAtMs) ? completedAtMs + actionStrategyMaxAgeMs : null
  const isTimeExpired =
    input.snapshotStatus === 'completed' && expiresAtMs !== null && input.now.getTime() >= expiresAtMs
  const staleReasons: ActionStrategyStaleReason[] = []

  if (input.snapshotStatus === 'completed' && !isCurrent) staleReasons.push('source_changed')
  if (isTimeExpired) staleReasons.push('time_expired')

  let freshness: ActionStrategyFreshness = 'not_generated'
  if (isCurrent && (input.snapshotStatus === 'pending' || input.snapshotStatus === 'processing')) {
    freshness = 'generating'
  } else if (isCurrent && input.snapshotStatus === 'failed') {
    freshness = 'failed'
  } else if (input.snapshotStatus === 'completed') {
    freshness = staleReasons.length > 0 ? 'stale' : 'fresh'
  }

  return {
    freshness,
    staleReasons,
    expiresAt: expiresAtMs === null ? null : new Date(expiresAtMs).toISOString(),
  }
}
