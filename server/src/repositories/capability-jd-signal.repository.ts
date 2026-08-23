import { and, asc, eq, isNull, or, sql } from 'drizzle-orm'
import type { JobAnalysisResult } from '@/types/opportunity'
import { db } from '../db/client'
import { capabilityJdSignalEmbeddings, jobAnalyses, jobOpportunities, resumeVersions } from '../db/schema'

export type CapabilityJdSignalEmbeddingRecord = typeof capabilityJdSignalEmbeddings.$inferInsert

export type CapabilityJdSignalIndexCandidate = {
  analysisId: string
  result: JobAnalysisResult
}

export type CapabilityJdSignalEmbeddingSource = {
  analysisId: string
  opportunityId: string
  company: string
  jobTitle: string
  resumeVersionId: string
  versionNumber: number
  signalType: 'strength' | 'gap'
  signalIndex: number
  title: string
  reason: string
  contentHash: string
  embeddingModel: string
  embedding: number[]
}

export interface CapabilityJdSignalIndexPersistence {
  findCompletedAnalysisFamily(analysisId: string): Promise<CapabilityJdSignalIndexCandidate[]>
  replaceAnalysisSignals(input: {
    analysisId: string
    embeddingModel: string
    signals: CapabilityJdSignalEmbeddingRecord[]
  }): Promise<'indexed' | 'unchanged'>
}

export interface CapabilityJdSignalCompensationPersistence {
  listUnindexedCompletedAnalysisIds(input: { limit: number; embeddingModel: string }): Promise<string[]>
}

export class DrizzleCapabilityJdSignalRepository
  implements CapabilityJdSignalIndexPersistence, CapabilityJdSignalCompensationPersistence
{
  async findCompletedAnalysisFamily(analysisId: string): Promise<CapabilityJdSignalIndexCandidate[]> {
    const rows = await db
      .select({ analysisId: jobAnalyses.id, result: jobAnalyses.result })
      .from(jobAnalyses)
      .where(
        and(
          eq(jobAnalyses.status, 'completed'),
          or(eq(jobAnalyses.id, analysisId), eq(jobAnalyses.sourceAnalysisId, analysisId)),
        ),
      )

    return rows.flatMap((row) => (row.result ? [{ analysisId: row.analysisId, result: row.result }] : []))
  }

  async replaceAnalysisSignals(input: {
    analysisId: string
    embeddingModel: string
    signals: CapabilityJdSignalEmbeddingRecord[]
  }): Promise<'indexed' | 'unchanged'> {
    return db.transaction(async (tx) => {
      const existing = await tx
        .select({
          signalType: capabilityJdSignalEmbeddings.signalType,
          signalIndex: capabilityJdSignalEmbeddings.signalIndex,
          contentHash: capabilityJdSignalEmbeddings.contentHash,
          embeddingModel: capabilityJdSignalEmbeddings.embeddingModel,
        })
        .from(capabilityJdSignalEmbeddings)
        .where(eq(capabilityJdSignalEmbeddings.analysisId, input.analysisId))
        .orderBy(asc(capabilityJdSignalEmbeddings.signalType), asc(capabilityJdSignalEmbeddings.signalIndex))

      const expected = input.signals
        .map((signal) => ({
          signalType: signal.signalType,
          signalIndex: signal.signalIndex,
          contentHash: signal.contentHash,
          embeddingModel: input.embeddingModel,
        }))
        .sort((left, right) =>
          left.signalType === right.signalType
            ? left.signalIndex - right.signalIndex
            : left.signalType.localeCompare(right.signalType),
        )
      const unchanged =
        existing.length === expected.length &&
        existing.every(
          (row, index) =>
            row.signalType === expected[index]?.signalType &&
            row.signalIndex === expected[index]?.signalIndex &&
            row.contentHash === expected[index]?.contentHash &&
            row.embeddingModel === expected[index]?.embeddingModel,
        )
      if (unchanged) return 'unchanged'

      await tx.delete(capabilityJdSignalEmbeddings).where(eq(capabilityJdSignalEmbeddings.analysisId, input.analysisId))
      if (input.signals.length > 0) await tx.insert(capabilityJdSignalEmbeddings).values(input.signals)
      return 'indexed'
    })
  }

  async listUnindexedCompletedAnalysisIds(input: { limit: number; embeddingModel: string }) {
    const rows = await db
      .select({ analysisId: jobAnalyses.id })
      .from(jobAnalyses)
      .leftJoin(
        capabilityJdSignalEmbeddings,
        and(
          eq(jobAnalyses.id, capabilityJdSignalEmbeddings.analysisId),
          eq(capabilityJdSignalEmbeddings.embeddingModel, input.embeddingModel),
        ),
      )
      .where(
        and(
          eq(jobAnalyses.status, 'completed'),
          isNull(capabilityJdSignalEmbeddings.id),
          isNull(jobAnalyses.sourceAnalysisId),
          sql`jsonb_array_length(COALESCE(${jobAnalyses.result}->'strengths', '[]'::jsonb)) + jsonb_array_length(COALESCE(${jobAnalyses.result}->'gaps', '[]'::jsonb)) > 0`,
        ),
      )
      .orderBy(asc(jobAnalyses.updatedAt), asc(jobAnalyses.id))
      .limit(input.limit)

    return rows.map((row) => row.analysisId)
  }

  async findSignalsByResumeId(input: {
    userId: string
    resumeId: string
    embeddingModel: string
  }): Promise<CapabilityJdSignalEmbeddingSource[]> {
    return db
      .select({
        analysisId: jobAnalyses.id,
        opportunityId: jobAnalyses.opportunityId,
        company: jobOpportunities.company,
        jobTitle: jobOpportunities.jobTitle,
        resumeVersionId: jobAnalyses.resumeVersionId,
        versionNumber: resumeVersions.versionNumber,
        signalType: capabilityJdSignalEmbeddings.signalType,
        signalIndex: capabilityJdSignalEmbeddings.signalIndex,
        title: capabilityJdSignalEmbeddings.title,
        reason: capabilityJdSignalEmbeddings.reason,
        contentHash: capabilityJdSignalEmbeddings.contentHash,
        embeddingModel: capabilityJdSignalEmbeddings.embeddingModel,
        embedding: capabilityJdSignalEmbeddings.embedding,
      })
      .from(capabilityJdSignalEmbeddings)
      .innerJoin(jobAnalyses, eq(capabilityJdSignalEmbeddings.analysisId, jobAnalyses.id))
      .innerJoin(jobOpportunities, eq(jobAnalyses.opportunityId, jobOpportunities.id))
      .innerJoin(resumeVersions, eq(jobAnalyses.resumeVersionId, resumeVersions.id))
      .where(
        and(
          eq(jobOpportunities.userId, input.userId),
          eq(jobAnalyses.resumeId, input.resumeId),
          eq(jobAnalyses.status, 'completed'),
          eq(capabilityJdSignalEmbeddings.embeddingModel, input.embeddingModel),
          isNull(jobOpportunities.deletedAt),
        ),
      )
  }
}

export const capabilityJdSignalRepository = new DrizzleCapabilityJdSignalRepository()
