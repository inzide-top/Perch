import {
  boolean,
  check,
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
import type { ReviewDocumentKind, ReviewDocumentResult, ReviewDocumentStatus } from '@/types/review'
import type { ActionStrategyAiSummary, ActionStrategySnapshotStatus } from '@/types/action-strategy'
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
import type {
  AgentWorkflowType,
  AnswerDeepEvaluationResult,
  AnswerEvidence,
  InterviewAnswerContent,
  InterviewAssistanceLevel,
  InterviewConfiguration,
  InterviewEvidenceStatus,
  InterviewFeedbackReasons,
  InterviewInteractionRole,
  InterviewInteractionType,
  InterviewModelSnapshot,
  InterviewOverallScoreStatus,
  InterviewQuestionContent,
  InterviewQuestionHints,
  InterviewSessionEvaluation,
  InterviewSessionStatus,
  InterviewSkip,
  InterviewTurnKind,
  InterviewTurnStatus,
  InterviewAssessmentPlan,
} from '@/shared/interview/schemas'

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

/**
 * 一份用户录入的真实笔试/面试复盘原文及其当前结构化提取结果。
 * 复盘文本有独立的异步状态和重试生命周期，因此不把这些字段继续堆进机会主表。
 */
export const reviewDocuments = pgTable(
  'review_documents',
  {
    id: uuid('id').primaryKey(),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => jobOpportunities.id, { onDelete: 'cascade' }),
    /** written_test 文档不绑定 interviewRound；interview 文档必须绑定一轮真实面试。 */
    sourceType: text('source_type').$type<ReviewDocumentKind>().notNull(),
    /** 删除已有复盘的面试轮次前，必须先明确处理复盘文档，避免静默丢失原文。 */
    interviewRoundId: uuid('interview_round_id').references(() => interviewRounds.id, { onDelete: 'restrict' }),
    rawText: text('raw_text').notNull(),
    status: text('status').$type<ReviewDocumentStatus>().notNull(),
    result: jsonb('result').$type<ReviewDocumentResult>(),
    /** 每次原文修改递增；异步任务完成时必须匹配同一 revision，避免旧任务覆盖新文本。 */
    revision: integer('revision').notNull().default(1),
    currentAttempt: integer('current_attempt').notNull().default(0),
    modelName: text('model_name'),
    promptVersion: text('prompt_version'),
    error: jsonb('error').$type<AgentRunError>(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    check(
      'review_documents_source_relation_check',
      sql`("source_type" = 'written_test' AND "interview_round_id" IS NULL) OR ("source_type" = 'interview' AND "interview_round_id" IS NOT NULL)`,
    ),
    uniqueIndex('review_documents_written_test_opportunity_unique')
      .on(table.opportunityId)
      .where(sql`"source_type" = 'written_test'`),
    uniqueIndex('review_documents_interview_round_unique')
      .on(table.interviewRoundId)
      .where(sql`"source_type" = 'interview'`),
    index('review_documents_opportunity_id_index').on(table.opportunityId),
    index('review_documents_status_index').on(table.status),
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

/**
 * 求职策略的 AI 文案快照。规则行动不依赖这张表，AI 失败时仍可展示规则结果。
 * API Key 不落库，只保存本次任务所使用的模型名称和 Base URL，方便审计与缓存隔离。
 */
export const actionStrategySnapshots = pgTable(
  'action_strategy_snapshots',
  {
    id: uuid('id').primaryKey(),
    userId: text('user_id').notNull(),
    status: text('status').$type<ActionStrategySnapshotStatus>().notNull(),
    inputFingerprint: text('input_fingerprint').notNull(),
    modelName: text('model_name'),
    modelBaseUrl: text('model_base_url'),
    promptVersion: text('prompt_version').notNull(),
    result: jsonb('result').$type<ActionStrategyAiSummary>(),
    error: jsonb('error').$type<AgentRunError>(),
    currentAttempt: integer('current_attempt').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    index('action_strategy_snapshots_user_id_updated_at_index').on(table.userId, table.updatedAt),
    index('action_strategy_snapshots_fingerprint_index').on(table.userId, table.inputFingerprint),
    uniqueIndex('action_strategy_snapshots_active_user_unique')
      .on(table.userId)
      .where(sql`"status" IN ('pending', 'processing')`),
  ],
)

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey(),
    workflowType: text('workflow_type').$type<AgentWorkflowType>().notNull().default('job_analysis'),
    analysisId: uuid('analysis_id').references(() => jobAnalyses.id, { onDelete: 'cascade' }),
    interviewSessionId: uuid('interview_session_id').references((): AnyPgColumn => interviewSessions.id, {
      onDelete: 'cascade',
    }),
    interviewTurnId: uuid('interview_turn_id').references((): AnyPgColumn => interviewTurns.id, {
      onDelete: 'set null',
    }),
    reviewDocumentId: uuid('review_document_id').references(() => reviewDocuments.id, { onDelete: 'set null' }),
    actionStrategySnapshotId: uuid('action_strategy_snapshot_id').references(() => actionStrategySnapshots.id, {
      onDelete: 'set null',
    }),
    operationKey: text('operation_key').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    status: text('status').$type<AgentRunStatus>().notNull(),
    modelName: text('model_name').notNull(),
    promptVersion: text('prompt_version').notNull(),
    input: jsonb('input').$type<JobAnalysisRunInput | Record<string, unknown>>().notNull(),
    rawOutput: text('raw_output'),
    parsedOutput: jsonb('parsed_output').$type<JobAnalysisResult | Record<string, unknown>>(),
    error: jsonb('error').$type<AgentRunError>(),
    durationMs: integer('duration_ms'),
    tokenUsage: jsonb('token_usage').$type<AgentTokenUsage>(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    uniqueIndex('agent_runs_operation_key_attempt_number_unique').on(table.operationKey, table.attemptNumber),
    index('agent_runs_analysis_id_index').on(table.analysisId),
    index('agent_runs_interview_session_id_index').on(table.interviewSessionId),
    index('agent_runs_interview_turn_id_index').on(table.interviewTurnId),
    index('agent_runs_review_document_id_index').on(table.reviewDocumentId),
    index('agent_runs_action_strategy_snapshot_id_index').on(table.actionStrategySnapshotId),
  ],
)

/** 一次模拟面试固定绑定创建时的 JD 分析、简历版本、模型和 Prompt 快照。 */
export const interviewSessions = pgTable(
  'interview_sessions',
  {
    id: uuid('id').primaryKey(),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => jobOpportunities.id, { onDelete: 'cascade' }),
    jobAnalysisId: uuid('job_analysis_id')
      .notNull()
      .references(() => jobAnalyses.id, { onDelete: 'restrict' }),
    jobAnalysisRunId: uuid('job_analysis_run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    resumeVersionId: uuid('resume_version_id')
      .notNull()
      .references(() => resumeVersions.id, { onDelete: 'restrict' }),
    configuration: jsonb('configuration').$type<InterviewConfiguration>().notNull(),
    assessmentPlan: jsonb('assessment_plan').$type<InterviewAssessmentPlan>(),
    modelSnapshot: jsonb('model_snapshot').$type<InterviewModelSnapshot>().notNull(),
    promptVersion: text('prompt_version').notNull(),
    currentTurnId: uuid('current_turn_id').references((): AnyPgColumn => interviewTurns.id, {
      onDelete: 'set null',
    }),
    status: text('status').$type<InterviewSessionStatus>().notNull(),
    evidenceStatus: text('evidence_status').$type<InterviewEvidenceStatus>().notNull(),
    endReason: text('end_reason'),
    latestOverallScore: integer('latest_overall_score'),
    overallScoreStatus: text('overall_score_status').$type<InterviewOverallScoreStatus>().notNull(),
    /** 乐观锁版本；所有影响状态机的写操作都必须携带并递增它。 */
    stateVersion: integer('state_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true, mode: 'string' }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true, mode: 'string' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('interview_sessions_opportunity_id_index').on(table.opportunityId),
    index('interview_sessions_status_index').on(table.status),
    index('interview_sessions_updated_at_index').on(table.updatedAt),
  ],
)

/** Turn 是一组问题与最终回答的唯一定位单位；追问通过 root/parent 关系形成主题树。 */
export const interviewTurns = pgTable(
  'interview_turns',
  {
    id: uuid('id').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => interviewSessions.id, { onDelete: 'cascade' }),
    assessmentPlanId: uuid('assessment_plan_id').notNull(),
    rootTurnId: uuid('root_turn_id').references((): AnyPgColumn => interviewTurns.id, { onDelete: 'set null' }),
    parentTurnId: uuid('parent_turn_id').references((): AnyPgColumn => interviewTurns.id, { onDelete: 'set null' }),
    kind: text('kind').$type<InterviewTurnKind>().notNull(),
    sequenceNumber: integer('sequence_number').notNull(),
    mainQuestionNumber: integer('main_question_number').notNull(),
    followUpNumber: integer('follow_up_number').notNull().default(0),
    question: jsonb('question').$type<InterviewQuestionContent>().notNull(),
    /** 私有出题材料，详情接口禁止直接序列化该字段。 */
    hints: jsonb('hints').$type<InterviewQuestionHints>().notNull(),
    answer: jsonb('answer').$type<InterviewAnswerContent>(),
    hintUsage: text('hint_usage').$type<InterviewAssistanceLevel>().notNull().default('none'),
    skip: jsonb('skip').$type<InterviewSkip>(),
    answerEvidence: jsonb('answer_evidence').$type<AnswerEvidence>(),
    answerSubmissionKey: uuid('answer_submission_key'),
    status: text('status').$type<InterviewTurnStatus>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    uniqueIndex('interview_turns_session_id_sequence_unique').on(table.sessionId, table.sequenceNumber),
    uniqueIndex('interview_turns_answer_submission_key_unique').on(table.answerSubmissionKey),
    uniqueIndex('interview_turns_one_open_turn_per_session_unique')
      .on(table.sessionId)
      .where(sql`"status" IN ('awaiting_answer', 'processing', 'processing_failed')`),
    index('interview_turns_session_id_index').on(table.sessionId),
    index('interview_turns_root_turn_id_index').on(table.rootTurnId),
  ],
)

/** 澄清请求、澄清回复和跑题引导属于当前 Turn 的附属消息，不会创建新的评分单元。 */
export const interviewTurnInteractions = pgTable(
  'interview_turn_interactions',
  {
    id: uuid('id').primaryKey(),
    turnId: uuid('turn_id')
      .notNull()
      .references(() => interviewTurns.id, { onDelete: 'cascade' }),
    replyToInteractionId: uuid('reply_to_interaction_id').references((): AnyPgColumn => interviewTurnInteractions.id, {
      onDelete: 'set null',
    }),
    clientMessageId: uuid('client_message_id'),
    sequenceNumber: integer('sequence_number').notNull(),
    role: text('role').$type<InterviewInteractionRole>().notNull(),
    type: text('type').$type<InterviewInteractionType>().notNull(),
    content: text('content').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    uniqueIndex('interview_turn_interactions_turn_sequence_unique').on(table.turnId, table.sequenceNumber),
    uniqueIndex('interview_turn_interactions_client_message_id_unique').on(table.clientMessageId),
    index('interview_turn_interactions_turn_id_index').on(table.turnId),
  ],
)

/** 当前总体评分只维护一份快照；TopicEvaluation 作为有界 JSON 随快照一起更新。 */
export const interviewSessionEvaluations = pgTable(
  'interview_session_evaluations',
  {
    id: uuid('id').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => interviewSessions.id, { onDelete: 'cascade' }),
    result: jsonb('result').$type<InterviewSessionEvaluation>().notNull(),
    evaluatedThroughTurnId: uuid('evaluated_through_turn_id').references(() => interviewTurns.id, {
      onDelete: 'set null',
    }),
    revision: integer('revision').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
    finalizedAt: timestamp('finalized_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [uniqueIndex('interview_session_evaluations_session_id_unique').on(table.sessionId)],
)

/** 深度点评按回答按需生成，独立于总体评分，避免未请求的点评扩大总体上下文。 */
export const answerDeepEvaluations = pgTable(
  'answer_deep_evaluations',
  {
    id: uuid('id').primaryKey(),
    turnId: uuid('turn_id')
      .notNull()
      .references(() => interviewTurns.id, { onDelete: 'cascade' }),
    status: text('status').$type<AgentRunStatus>().notNull(),
    result: jsonb('result').$type<AnswerDeepEvaluationResult>(),
    error: jsonb('error').$type<AgentRunError>(),
    modelName: text('model_name').notNull(),
    promptVersion: text('prompt_version').notNull(),
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [uniqueIndex('answer_deep_evaluations_turn_id_unique').on(table.turnId)],
)

/** 轻反馈可撤销；一旦提交明确原因或备注，lockedAt 固化该反馈。 */
export const interviewQuestionFeedback = pgTable(
  'interview_question_feedback',
  {
    id: uuid('id').primaryKey(),
    turnId: uuid('turn_id')
      .notNull()
      .references(() => interviewTurns.id, { onDelete: 'cascade' }),
    rating: text('rating').$type<'like' | 'dislike'>().notNull(),
    reasons: jsonb('reasons').$type<InterviewFeedbackReasons>().notNull(),
    comment: text('comment'),
    lockedAt: timestamp('locked_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [uniqueIndex('interview_question_feedback_turn_id_unique').on(table.turnId)],
)
