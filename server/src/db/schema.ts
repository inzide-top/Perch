import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { ResumeContent, VersionDiffItem } from '@/types/resume'
import type {
  AgentRunError,
  AgentRunStatus,
  AgentTokenUsage,
  InterviewRoundResult,
  InterviewRoundStatus,
  InterviewRoundType,
  JobAnalysisResult,
  JobAnalysisRunInput,
  JobAnalysisStatus,
  JobOpportunityStatus,
  OpportunityIntentionLevel,
  OpportunityStatusChangeTrigger,
  OpportunityTerminationReasonCode,
} from '@/types/opportunity'

export const resumes = pgTable('resumes', {
  id: uuid('id').primaryKey(),
  userId: text('user_id').notNull(),
  title: text('title').notNull(),
  currentVersionId: uuid('current_version_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
})

export const resumeVersions = pgTable(
  'resume_versions',
  {
    id: uuid('id').primaryKey(),
    resumeId: uuid('resume_id')
      .notNull()
      .references(() => resumes.id),
    versionNumber: integer('version_number').notNull(),
    parentVersionId: uuid('parent_version_id'),
    content: jsonb('content').$type<ResumeContent>().notNull(),
    diffSummary: jsonb('diff_summary').$type<VersionDiffItem[]>().notNull(),
    changeNote: text('change_note').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [uniqueIndex('resume_versions_resume_id_version_number_unique').on(table.resumeId, table.versionNumber)],
)

/** 一条岗位机会，同时保存 JD 原文和当前求职流程状态。 */
export const jobOpportunities = pgTable(
  'job_opportunities',
  {
    id: uuid('id').primaryKey(),
    userId: text('user_id').notNull(),
    company: text('company').notNull(),
    jobTitle: text('job_title').notNull(),
    /** 同一用户的规范化精确重复 JD 标识；旧数据允许为空，避免历史迁移失败。 */
    dedupeFingerprint: text('dedupe_fingerprint'),
    address: jsonb('address').$type<string[]>().notNull(),
    introduction: text('introduction').notNull(),
    description: text('description').notNull(),
    status: text('status').$type<JobOpportunityStatus>().notNull(),
    includeWrittenTest: boolean('include_written_test').notNull(),
    intentionLevel: text('intention_level').$type<OpportunityIntentionLevel>().notNull(),
    industry: text('industry').notNull(),
    note: text('note').notNull(),
    writtenTestScheduledAt: timestamp('written_test_scheduled_at', { withTimezone: true, mode: 'string' }),
    writtenTestReviewNote: text('written_test_review_note'),
    writtenTestReviewedAt: timestamp('written_test_reviewed_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('job_opportunities_user_id_updated_at_index').on(table.userId, table.updatedAt),
    uniqueIndex('job_opportunities_user_dedupe_fingerprint_unique').on(table.userId, table.dedupeFingerprint),
  ],
)

/** 每一次状态变更都保留，供流程回放和后续求职分析使用。 */
export const opportunityStatusHistory = pgTable(
  'opportunity_status_history',
  {
    id: uuid('id').primaryKey(),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => jobOpportunities.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status').$type<JobOpportunityStatus>(),
    toStatus: text('to_status').$type<JobOpportunityStatus>().notNull(),
    trigger: text('trigger').$type<OpportunityStatusChangeTrigger>().notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [index('opportunity_status_history_opportunity_id_index').on(table.opportunityId)],
)

/** 一条机会可有任意多轮面试；sequence 决定一面、二面、三面的业务顺序。 */
export const interviewRounds = pgTable(
  'interview_rounds',
  {
    id: uuid('id').primaryKey(),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => jobOpportunities.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    type: text('type').$type<InterviewRoundType>().notNull(),
    title: text('title').notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true, mode: 'string' }),
    status: text('status').$type<InterviewRoundStatus>().notNull(),
    result: text('result').$type<InterviewRoundResult>().notNull(),
    note: text('note').notNull(),
    reviewNote: text('review_note').notNull(),
    keyTakeaways: jsonb('key_takeaways').$type<string[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    uniqueIndex('interview_rounds_opportunity_id_sequence_unique').on(table.opportunityId, table.sequence),
    index('interview_rounds_opportunity_id_index').on(table.opportunityId),
  ],
)

/** 一条机会最多关闭一次；相关轮次只作可选关联，并保留标题快照。 */
export const opportunityTerminations = pgTable(
  'opportunity_terminations',
  {
    id: uuid('id').primaryKey(),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => jobOpportunities.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status').$type<JobOpportunityStatus>().notNull(),
    relatedInterviewRoundId: uuid('related_interview_round_id').references(() => interviewRounds.id, {
      onDelete: 'set null',
    }),
    relatedInterviewRoundTitle: text('related_interview_round_title'),
    reasonCode: text('reason_code').$type<OpportunityTerminationReasonCode>().notNull(),
    reasonNote: text('reason_note').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [uniqueIndex('opportunity_terminations_opportunity_id_unique').on(table.opportunityId)],
)

/** 一条机会只维护一份当前有效分析；每次模型执行记录在后续的 agent_runs 表。 */
export const jobAnalyses = pgTable(
  'job_analyses',
  {
    id: uuid('id').primaryKey(),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => jobOpportunities.id, { onDelete: 'cascade' }),
    resumeId: uuid('resume_id')
      .notNull()
      .references(() => resumes.id, { onDelete: 'cascade' }),
    resumeVersionId: uuid('resume_version_id')
      .notNull()
      .references(() => resumeVersions.id, { onDelete: 'cascade' }),
    status: text('status').$type<JobAnalysisStatus>().notNull(),
    /** 指向同一业务输入正在执行或已完成的源分析；空值代表实际发起模型请求的源任务。 */
    sourceAnalysisId: uuid('source_analysis_id').references((): AnyPgColumn => jobAnalyses.id, {
      onDelete: 'set null',
    }),
    currentAttempt: integer('current_attempt').notNull().default(1),
    inputFingerprint: text('input_fingerprint'),
    modelName: text('model_name'),
    result: jsonb('result').$type<JobAnalysisResult>(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    uniqueIndex('job_analyses_opportunity_id_unique').on(table.opportunityId),
    index('job_analyses_input_fingerprint_index').on(table.inputFingerprint),
    index('job_analyses_source_analysis_id_index').on(table.sourceAnalysisId),
    uniqueIndex('job_analyses_active_source_fingerprint_unique')
      .on(table.inputFingerprint)
      .where(sql`"source_analysis_id" IS NULL AND "status" IN ('pending', 'processing')`),
  ],
)

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey(),
    analysisId: uuid('analysis_id')
      .notNull()
      .references(() => jobAnalyses.id, { onDelete: 'cascade' }),
    attemptNumber: integer('attempt_number').notNull(),
    status: text('status').$type<AgentRunStatus>().notNull(),
    modelName: text('model_name').notNull(),
    promptVersion: text('prompt_version').notNull(),
    input: jsonb('input').$type<JobAnalysisRunInput>().notNull(),
    rawOutput: text('raw_output'),
    parsedOutput: jsonb('parsed_output').$type<JobAnalysisResult>(),
    error: jsonb('error').$type<AgentRunError>(),
    durationMs: integer('duration_ms'),
    tokenUsage: jsonb('token_usage').$type<AgentTokenUsage>(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    uniqueIndex('agent_runs_analysis_id_attempt_number_unique').on(table.analysisId, table.attemptNumber),
    index('agent_runs_analysis_id_index').on(table.analysisId),
  ],
)
