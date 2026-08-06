import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { actionStrategySnapshots, interviewRounds, opportunityStatusHistory } from '../db/schema'
import type { ActionStrategyAiSummary, ActionStrategySnapshotStatus } from '@/types/action-strategy'
import type { AgentRunError } from '@/types/opportunity'

export type StrategyOpportunityActivity = {
  statusHistory: Array<{
    toStatus: NonNullable<typeof opportunityStatusHistory.$inferSelect.toStatus>
    createdAt: string
  }>
  interviewRounds: Array<{
    id: string
    title: string
    scheduledAt: string | null
    status: NonNullable<typeof interviewRounds.$inferSelect.status>
    result: NonNullable<typeof interviewRounds.$inferSelect.result>
    updatedAt: string
  }>
}

type SnapshotRow = typeof actionStrategySnapshots.$inferSelect

export type ActionStrategySnapshotRecord = SnapshotRow

export class DrizzleActionStrategyRepository {
  async findActivityByOpportunityIds(opportunityIds: string[]) {
    const result = new Map<string, StrategyOpportunityActivity>()
    opportunityIds.forEach((id) => result.set(id, { statusHistory: [], interviewRounds: [] }))
    if (opportunityIds.length === 0) return result

    const [historyRows, roundRows] = await Promise.all([
      db
        .select({
          opportunityId: opportunityStatusHistory.opportunityId,
          toStatus: opportunityStatusHistory.toStatus,
          createdAt: opportunityStatusHistory.createdAt,
        })
        .from(opportunityStatusHistory)
        .where(inArray(opportunityStatusHistory.opportunityId, opportunityIds))
        .orderBy(asc(opportunityStatusHistory.createdAt)),
      db
        .select({
          id: interviewRounds.id,
          opportunityId: interviewRounds.opportunityId,
          title: interviewRounds.title,
          scheduledAt: interviewRounds.scheduledAt,
          status: interviewRounds.status,
          result: interviewRounds.result,
          updatedAt: interviewRounds.updatedAt,
        })
        .from(interviewRounds)
        .where(inArray(interviewRounds.opportunityId, opportunityIds))
        .orderBy(desc(interviewRounds.updatedAt)),
    ])

    for (const row of historyRows) {
      const activity = result.get(row.opportunityId)
      if (!activity) continue
      activity.statusHistory.push({ toStatus: row.toStatus, createdAt: new Date(row.createdAt).toISOString() })
    }

    for (const row of roundRows) {
      const activity = result.get(row.opportunityId)
      if (!activity) continue
      activity.interviewRounds.push({
        id: row.id,
        title: row.title,
        scheduledAt: row.scheduledAt ? new Date(row.scheduledAt).toISOString() : null,
        status: row.status,
        result: row.result,
        updatedAt: new Date(row.updatedAt).toISOString(),
      })
    }

    return result
  }

  async findLatestByUserId(userId: string) {
    const [snapshot] = await db
      .select()
      .from(actionStrategySnapshots)
      .where(eq(actionStrategySnapshots.userId, userId))
      .orderBy(desc(actionStrategySnapshots.updatedAt))
      .limit(1)
    return snapshot ?? null
  }

  async findById(snapshotId: string, userId: string) {
    const [snapshot] = await db
      .select()
      .from(actionStrategySnapshots)
      .where(and(eq(actionStrategySnapshots.id, snapshotId), eq(actionStrategySnapshots.userId, userId)))
      .limit(1)
    return snapshot ?? null
  }

  async findCompletedByFingerprint(input: {
    userId: string
    inputFingerprint: string
    modelName: string
    modelBaseUrl: string
    promptVersion: string
  }) {
    const [snapshot] = await db
      .select()
      .from(actionStrategySnapshots)
      .where(
        and(
          eq(actionStrategySnapshots.userId, input.userId),
          eq(actionStrategySnapshots.inputFingerprint, input.inputFingerprint),
          eq(actionStrategySnapshots.modelName, input.modelName),
          eq(actionStrategySnapshots.modelBaseUrl, input.modelBaseUrl),
          eq(actionStrategySnapshots.promptVersion, input.promptVersion),
          eq(actionStrategySnapshots.status, 'completed'),
        ),
      )
      .orderBy(desc(actionStrategySnapshots.updatedAt))
      .limit(1)
    return snapshot ?? null
  }

  async findActiveByUserId(userId: string) {
    const [snapshot] = await db
      .select()
      .from(actionStrategySnapshots)
      .where(
        and(
          eq(actionStrategySnapshots.userId, userId),
          inArray(actionStrategySnapshots.status, ['pending', 'processing'] satisfies ActionStrategySnapshotStatus[]),
        ),
      )
      .orderBy(desc(actionStrategySnapshots.updatedAt))
      .limit(1)
    return snapshot ?? null
  }

  async createSnapshot(input: typeof actionStrategySnapshots.$inferInsert) {
    const [snapshot] = await db.insert(actionStrategySnapshots).values(input).returning()
    return snapshot
  }

  async markProcessing(snapshotId: string, attempt: number, updatedAt: string) {
    const [snapshot] = await db
      .update(actionStrategySnapshots)
      .set({ status: 'processing', currentAttempt: attempt, updatedAt })
      .where(and(eq(actionStrategySnapshots.id, snapshotId), eq(actionStrategySnapshots.status, 'pending')))
      .returning()
    if (!snapshot) throw new Error('行动策略快照不存在或已开始执行')
    return snapshot
  }

  async completeSnapshot(input: { snapshotId: string; result: ActionStrategyAiSummary; completedAt: string }) {
    const [snapshot] = await db
      .update(actionStrategySnapshots)
      .set({
        status: 'completed',
        result: input.result,
        error: null,
        updatedAt: input.completedAt,
        completedAt: input.completedAt,
      })
      .where(and(eq(actionStrategySnapshots.id, input.snapshotId), eq(actionStrategySnapshots.status, 'processing')))
      .returning()
    if (!snapshot) throw new Error('行动策略快照不存在或已结束')
    return snapshot
  }

  async failSnapshot(input: { snapshotId: string; error: AgentRunError; updatedAt: string }) {
    const [snapshot] = await db
      .update(actionStrategySnapshots)
      .set({ status: 'failed', error: input.error, updatedAt: input.updatedAt, completedAt: input.updatedAt })
      .where(
        and(
          eq(actionStrategySnapshots.id, input.snapshotId),
          inArray(actionStrategySnapshots.status, ['pending', 'processing'] satisfies ActionStrategySnapshotStatus[]),
        ),
      )
      .returning()
    if (!snapshot) throw new Error('行动策略快照不存在或已结束')
    return snapshot
  }
}

export const actionStrategyRepository = new DrizzleActionStrategyRepository()
