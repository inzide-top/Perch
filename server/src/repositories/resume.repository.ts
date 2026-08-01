import { desc, eq } from 'drizzle-orm'
import type { Resume, ResumeVersion } from '@/types/resume'
import { db } from '../db/client'
import { resumes, resumeVersions } from '../db/schema'

export type ResumeRecord = Resume & {
  userId: string
}

export type SaveResumeStateRecord = {
  resume: ResumeRecord
  version: ResumeVersion
}

function toIsoTimestamp(value: string) {
  return new Date(value).toISOString()
}

function toResumeRecord(row: typeof resumes.$inferSelect): ResumeRecord {
  return {
    ...row,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
  }
}

function toResumeVersion(row: typeof resumeVersions.$inferSelect): ResumeVersion {
  return {
    ...row,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
  }
}

export class DrizzleResumeRepository {
  async createResumeWithInitialVersion(record: SaveResumeStateRecord) {
    await db.transaction(async (tx) => {
      await tx.insert(resumes).values(record.resume)
      await tx.insert(resumeVersions).values(record.version)
    })
  }

  async updateCurrentVersion(record: SaveResumeStateRecord) {
    await db.transaction(async (tx) => {
      await tx
        .update(resumes)
        .set({
          title: record.resume.title,
          updatedAt: record.resume.updatedAt,
        })
        .where(eq(resumes.id, record.resume.id))
      await tx
        .update(resumeVersions)
        .set({
          content: record.version.content,
          updatedAt: record.version.updatedAt,
        })
        .where(eq(resumeVersions.id, record.version.id))
    })
  }

  async createNewVersionAndSetCurrent(record: SaveResumeStateRecord) {
    await db.transaction(async (tx) => {
      await tx.insert(resumeVersions).values(record.version)
      await tx
        .update(resumes)
        .set({
          title: record.resume.title,
          currentVersionId: record.resume.currentVersionId,
          updatedAt: record.resume.updatedAt,
        })
        .where(eq(resumes.id, record.resume.id))
    })
  }

  async findResumeById(resumeId: string): Promise<ResumeRecord | null> {
    const [resume] = await db.select().from(resumes).where(eq(resumes.id, resumeId)).limit(1)
    return resume ? toResumeRecord(resume) : null
  }

  async findVersionById(versionId: string): Promise<ResumeVersion | null> {
    const [version] = await db.select().from(resumeVersions).where(eq(resumeVersions.id, versionId)).limit(1)
    return version ? toResumeVersion(version) : null
  }

  async findVersionsByResumeId(resumeId: string): Promise<ResumeVersion[]> {
    const versions = await db
      .select()
      .from(resumeVersions)
      .where(eq(resumeVersions.resumeId, resumeId))
      .orderBy(desc(resumeVersions.versionNumber))

    return versions.map(toResumeVersion)
  }

  async findResumesByUserId(userId: string): Promise<ResumeRecord[]> {
    const resumeRows = await db
      .select()
      .from(resumes)
      .where(eq(resumes.userId, userId))
      .orderBy(desc(resumes.updatedAt))
    return resumeRows.map(toResumeRecord)
  }

  async findResumeWorkspaceByUserId(userId: string) {
    const [resumeRows, versionRows] = await Promise.all([
      db.select().from(resumes).where(eq(resumes.userId, userId)).orderBy(desc(resumes.updatedAt)),
      db
        .select({ version: resumeVersions })
        .from(resumeVersions)
        .innerJoin(resumes, eq(resumeVersions.resumeId, resumes.id))
        .where(eq(resumes.userId, userId))
        .orderBy(desc(resumeVersions.versionNumber)),
    ])

    return {
      resumes: resumeRows.map(toResumeRecord),
      versions: versionRows.map(({ version }) => toResumeVersion(version)),
    }
  }

  async deleteResumeByResumeId(resumeId: string) {
    await db.transaction(async (tx) => {
      await tx.delete(resumeVersions).where(eq(resumeVersions.resumeId, resumeId))
      await tx.delete(resumes).where(eq(resumes.id, resumeId))
    })
  }
}

export const resumeRepository = new DrizzleResumeRepository()
