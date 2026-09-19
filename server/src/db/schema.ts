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
  vector,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { ResumeContent, VersionDiffItem } from '@/types/resume'
import type { ResumePdfImportResponse, ResumePdfImportTaskStatus } from '@/shared/resume/pdf-import'
import type { ReviewDocumentKind, ReviewDocumentResult, ReviewDocumentStatus } from '@/types/review'
import type { ActionStrategyAiSummary, ActionStrategySnapshotStatus } from '@/types/action-strategy'
import type { FeedbackType } from '@/shared/feedback/schemas'
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
import type {
  ChatArtifactStatus,
  ChatArtifactType,
  ChatCommandStatus,
  ChatCommandType,
  ChatConversationScopeType,
  ChatJsonObject,
  ChatMessagePart,
  ChatMessageReference,
  ChatMessageRole,
  ChatMessageStatus,
  ChatModelSnapshot,
  ChatRunBudget,
  ChatRunEventType,
  ChatRunPhase,
  ChatRunStatus,
  ChatToolActionStatus,
  ChatToolUserDecision,
} from '@/shared/chat/schemas'
import { RETRIEVAL_EMBEDDING_DIMENSIONS } from '../../../src/shared/retrieval/constants'

export const userModelSettings = pgTable('user_model_settings', {
  userId: text('user_id').primaryKey(),
  encryptedPayload: text('encrypted_payload').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
}).enableRLS()

export const userFeedback = pgTable(
  'user_feedback',
  {
    id: uuid('id').primaryKey(),
    userId: text('user_id').notNull(),
    type: text('type').$type<FeedbackType>().notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [index('user_feedback_user_id_created_at_index').on(table.userId, table.createdAt)],
).enableRLS()

export const resumes = pgTable('resumes', {
  id: uuid('id').primaryKey(),
  userId: text('user_id').notNull(),
  title: text('title').notNull(),
  currentVersionId: uuid('current_version_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
}).enableRLS()

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
).enableRLS()

/** PDF 文本提取后异步结构化；结果独立于正式简历，必须经用户审核才会进入版本链。 */
export const resumePdfImportTasks = pgTable(
  'resume_pdf_import_tasks',
  {
    id: uuid('id').primaryKey(),
    userId: text('user_id').notNull(),
    status: text('status').$type<ResumePdfImportTaskStatus>().notNull(),
    fileName: text('file_name').notNull(),
    pageCount: integer('page_count').notNull(),
    characterCount: integer('character_count').notNull(),
    extractedText: text('extracted_text'),
    result: jsonb('result').$type<ResumePdfImportResponse>(),
    error: jsonb('error').$type<{ code: string; message: string; retryable: boolean }>(),
    modelName: text('model_name').notNull(),
    currentAttempt: integer('current_attempt').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [index('resume_pdf_import_tasks_user_id_updated_at_index').on(table.userId, table.updatedAt)],
).enableRLS()

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
    intentionLevel: text('intention_level').$type<OpportunityIntentionLevel>(),
    industry: text('industry').notNull(),
    note: text('note').notNull(),
    writtenTestScheduledAt: timestamp('written_test_scheduled_at', { withTimezone: true, mode: 'string' }),
    writtenTestReviewNote: text('written_test_review_note'),
    writtenTestReviewedAt: timestamp('written_test_reviewed_at', { withTimezone: true, mode: 'string' }),
    /** 软删除后不再进入日常机会列表，但保留关联的历史模拟面试和能力证据。 */
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('job_opportunities_user_id_updated_at_index').on(table.userId, table.updatedAt),
    uniqueIndex('job_opportunities_user_dedupe_fingerprint_unique')
      .on(table.userId, table.dedupeFingerprint)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
).enableRLS()

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
).enableRLS()

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
).enableRLS()

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
).enableRLS()

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
).enableRLS()

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
).enableRLS()

/**
 * JD 分析中优势/待补强项的语义索引。原始结论仍保存在 job_analyses.result；
 * 这张表只是可重建的派生数据，用于能力画像做跨岗位语义归并。
 */
export const capabilityJdSignalEmbeddings = pgTable(
  'capability_jd_signal_embeddings',
  {
    id: uuid('id').primaryKey(),
    analysisId: uuid('analysis_id')
      .notNull()
      .references(() => jobAnalyses.id, { onDelete: 'cascade' }),
    signalType: text('signal_type').$type<'strength' | 'gap'>().notNull(),
    signalIndex: integer('signal_index').notNull(),
    title: text('title').notNull(),
    reason: text('reason').notNull(),
    contentHash: text('content_hash').notNull(),
    embeddingModel: text('embedding_model').notNull(),
    embedding: vector('embedding', { dimensions: RETRIEVAL_EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    check('capability_jd_signal_embeddings_signal_index_check', sql`${table.signalIndex} >= 0`),
    check('capability_jd_signal_embeddings_signal_type_check', sql`${table.signalType} IN ('strength', 'gap')`),
    uniqueIndex('capability_jd_signal_embeddings_analysis_type_index_unique').on(
      table.analysisId,
      table.signalType,
      table.signalIndex,
    ),
    index('capability_jd_signal_embeddings_analysis_id_index').on(table.analysisId),
    index('capability_jd_signal_embeddings_model_index').on(table.embeddingModel),
  ],
).enableRLS()

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
).enableRLS()

/** 全局或机会内的一组 AI 对话；Scope 只决定上下文边界，不复制机会正文。 */
export const chatConversations = pgTable(
  'chat_conversations',
  {
    id: uuid('id').primaryKey(),
    userId: text('user_id').notNull(),
    title: text('title').notNull(),
    scopeType: text('scope_type').$type<ChatConversationScopeType>().notNull(),
    opportunityId: uuid('opportunity_id').references(() => jobOpportunities.id, { onDelete: 'cascade' }),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'string' }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    check(
      'chat_conversations_scope_relation_check',
      sql`("scope_type" = 'global' AND "opportunity_id" IS NULL) OR ("scope_type" = 'opportunity' AND "opportunity_id" IS NOT NULL)`,
    ),
    index('chat_conversations_user_id_updated_at_index').on(table.userId, table.updatedAt),
    index('chat_conversations_opportunity_id_index').on(table.opportunityId),
  ],
).enableRLS()

/**
 * 当前会话较早消息的增量摘要。原始消息仍完整保留在 chat_messages；
 * 这里只保存可重建的派生缓存和已摘要游标，用来限制模型上下文长度。
 */
export const chatConversationSummaries = pgTable(
  'chat_conversation_summaries',
  {
    conversationId: uuid('conversation_id')
      .primaryKey()
      .references(() => chatConversations.id, { onDelete: 'cascade' }),
    summary: jsonb('summary').$type<ChatJsonObject>().notNull(),
    summarizedThroughSequence: integer('summarized_through_sequence').notNull(),
    revision: integer('revision').notNull().default(1),
    modelName: text('model_name').notNull(),
    promptVersion: text('prompt_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    check(
      'chat_conversation_summaries_sequence_check',
      sql`${table.summarizedThroughSequence} > 0 AND ${table.revision} > 0`,
    ),
  ],
).enableRLS()

/** 对话展示消息只保存有界 Parts；工具输入和执行结果分别保存在 chat_tool_actions。 */
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => chatConversations.id, { onDelete: 'cascade' }),
    chatRunId: uuid('chat_run_id').references((): AnyPgColumn => chatRuns.id, { onDelete: 'set null' }),
    role: text('role').$type<ChatMessageRole>().notNull(),
    status: text('status').$type<ChatMessageStatus>().notNull(),
    sequenceNumber: integer('sequence_number').notNull(),
    replacesMessageId: uuid('replaces_message_id').references((): AnyPgColumn => chatMessages.id, {
      onDelete: 'set null',
    }),
    parts: jsonb('parts').$type<ChatMessagePart[]>().notNull(),
    references: jsonb('references').$type<ChatMessageReference[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    uniqueIndex('chat_messages_conversation_id_sequence_unique').on(table.conversationId, table.sequenceNumber),
    index('chat_messages_chat_run_id_index').on(table.chatRunId),
    index('chat_messages_replaces_message_id_index').on(table.replacesMessageId),
  ],
).enableRLS()

/** 一次用户请求触发的完整 Agent 工作流；内部每次模型调用仍单独写入 agent_runs。 */
export const chatRuns = pgTable(
  'chat_runs',
  {
    id: uuid('id').primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => chatConversations.id, { onDelete: 'cascade' }),
    inputMessageId: uuid('input_message_id')
      .notNull()
      .references((): AnyPgColumn => chatMessages.id, { onDelete: 'cascade' }),
    outputMessageId: uuid('output_message_id').references((): AnyPgColumn => chatMessages.id, { onDelete: 'set null' }),
    status: text('status').$type<ChatRunStatus>().notNull(),
    phase: text('phase').$type<ChatRunPhase>(),
    revision: integer('revision').notNull().default(1),
    modelSnapshot: jsonb('model_snapshot').$type<ChatModelSnapshot>().notNull(),
    promptVersion: text('prompt_version').notNull(),
    budget: jsonb('budget').$type<ChatRunBudget>().notNull(),
    tokenUsage: jsonb('token_usage').$type<AgentTokenUsage>(),
    input: jsonb('input').$type<ChatJsonObject>().notNull(),
    runtimeState: jsonb('runtime_state').$type<ChatJsonObject>(),
    error: jsonb('error').$type<AgentRunError>(),
    retryOfRunId: uuid('retry_of_run_id').references((): AnyPgColumn => chatRuns.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'string' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    uniqueIndex('chat_runs_active_input_message_unique')
      .on(table.inputMessageId)
      .where(sql`"status" IN ('queued', 'running', 'waiting_input', 'waiting_confirmation', 'cancelling')`),
    uniqueIndex('chat_runs_active_conversation_unique')
      .on(table.conversationId)
      .where(sql`"status" IN ('queued', 'running', 'waiting_input', 'waiting_confirmation', 'cancelling')`),
    check(
      'chat_runs_status_phase_check',
      sql`("status" = 'running' AND "phase" IS NOT NULL) OR ("status" <> 'running' AND "phase" IS NULL)`,
    ),
    index('chat_runs_conversation_id_updated_at_index').on(table.conversationId, table.updatedAt),
    index('chat_runs_created_at_id_index').on(table.createdAt, table.id),
    index('chat_runs_status_index').on(table.status),
    index('chat_runs_input_message_id_index').on(table.inputMessageId),
    index('chat_runs_retry_of_run_id_index').on(table.retryOfRunId),
  ],
).enableRLS()

/** 可断点续接的产品事件；sequence 是单个 ChatRun 内唯一的事件顺序。 */
export const chatRunEvents = pgTable(
  'chat_run_events',
  {
    id: uuid('id').primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => chatRuns.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    eventType: text('event_type').$type<ChatRunEventType>().notNull(),
    stateRevision: integer('state_revision').notNull(),
    payload: jsonb('payload').$type<ChatJsonObject>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    uniqueIndex('chat_run_events_run_id_sequence_unique').on(table.runId, table.sequence),
    index('chat_run_events_run_id_index').on(table.runId),
  ],
).enableRLS()

/** 每一次工具调用及其确认/幂等信息；工具结果不混入消息正文。 */
export const chatToolActions = pgTable(
  'chat_tool_actions',
  {
    id: uuid('id').primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => chatRuns.id, { onDelete: 'cascade' }),
    toolName: text('tool_name').notNull(),
    toolVersion: text('tool_version').notNull(),
    input: jsonb('input').$type<ChatJsonObject>().notNull(),
    status: text('status').$type<ChatToolActionStatus>().notNull(),
    missingArguments: jsonb('missing_arguments').$type<string[]>(),
    requiresConfirmation: boolean('requires_confirmation').notNull().default(false),
    userDecision: text('user_decision').$type<ChatToolUserDecision>(),
    output: jsonb('output').$type<ChatJsonObject>(),
    error: jsonb('error').$type<AgentRunError>(),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    uniqueIndex('chat_tool_actions_run_id_idempotency_unique').on(table.runId, table.idempotencyKey),
    index('chat_tool_actions_run_id_status_index').on(table.runId, table.status),
  ],
).enableRLS()

/** 前端 Command 的幂等收据；expectedRevision 防止旧页面覆盖当前 Agent 状态。 */
export const chatCommands = pgTable(
  'chat_commands',
  {
    id: uuid('id').primaryKey(),
    commandId: uuid('command_id').notNull(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => chatConversations.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => chatRuns.id, { onDelete: 'set null' }),
    type: text('type').$type<ChatCommandType>().notNull(),
    expectedRevision: integer('expected_revision'),
    payloadHash: text('payload_hash').notNull(),
    payload: jsonb('payload').$type<ChatJsonObject>().notNull(),
    status: text('status').$type<ChatCommandStatus>().notNull(),
    result: jsonb('result').$type<ChatJsonObject>(),
    rejectionCode: text('rejection_code'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    handledAt: timestamp('handled_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    uniqueIndex('chat_commands_command_id_unique').on(table.commandId),
    index('chat_commands_conversation_id_created_at_index').on(table.conversationId, table.createdAt),
    index('chat_commands_run_id_index').on(table.runId),
  ],
).enableRLS()

/** 对话中可下载或继续编辑的 Markdown 产物；第一版不做二进制附件。 */
export const chatArtifacts = pgTable(
  'chat_artifacts',
  {
    id: uuid('id').primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => chatConversations.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => chatRuns.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').references((): AnyPgColumn => chatMessages.id, { onDelete: 'set null' }),
    type: text('type').$type<ChatArtifactType>().notNull(),
    title: text('title').notNull(),
    fileName: text('file_name').notNull(),
    status: text('status').$type<ChatArtifactStatus>().notNull(),
    content: text('content'),
    error: jsonb('error').$type<AgentRunError>(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    index('chat_artifacts_conversation_id_index').on(table.conversationId),
    index('chat_artifacts_run_id_index').on(table.runId),
    index('chat_artifacts_message_id_index').on(table.messageId),
  ],
).enableRLS()

/**
 * 已完成 ChatRun 的可检索文本分块。只保存完整 Embedding，避免留下无法参与检索的半成品记录。
 * conversation/run 级联删除，确保用户删除会话时不会残留向量记忆。
 */
export const chatMemoryDocuments = pgTable(
  'chat_memory_documents',
  {
    id: uuid('id').primaryKey(),
    userId: text('user_id').notNull(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => chatConversations.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => chatRuns.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    scopeType: text('scope_type').$type<'global' | 'opportunity'>().notNull(),
    opportunityIds: jsonb('opportunity_ids').$type<string[]>().notNull(),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    embeddingModel: text('embedding_model').notNull(),
    embedding: vector('embedding', { dimensions: RETRIEVAL_EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    check('chat_memory_documents_chunk_index_check', sql`"chunk_index" >= 0`),
    check(
      'chat_memory_documents_scope_check',
      sql`("scope_type" = 'global' AND jsonb_array_length("opportunity_ids") = 0) OR ("scope_type" = 'opportunity' AND jsonb_array_length("opportunity_ids") > 0)`,
    ),
    uniqueIndex('chat_memory_documents_run_id_chunk_index_unique').on(table.runId, table.chunkIndex),
    index('chat_memory_documents_user_model_index').on(table.userId, table.embeddingModel),
    index('chat_memory_documents_conversation_id_index').on(table.conversationId),
    index('chat_memory_documents_opportunity_ids_index').using('gin', table.opportunityIds),
    index('chat_memory_documents_embedding_hnsw_index').using('hnsw', table.embedding.op('vector_cosine_ops')),
  ],
).enableRLS()

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
    chatRunId: uuid('chat_run_id').references(() => chatRuns.id, { onDelete: 'cascade' }),
    reviewDocumentId: uuid('review_document_id').references(() => reviewDocuments.id, { onDelete: 'set null' }),
    resumePdfImportTaskId: uuid('resume_pdf_import_task_id').references(() => resumePdfImportTasks.id, {
      onDelete: 'set null',
    }),
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
    index('agent_runs_chat_run_id_index').on(table.chatRunId),
    index('agent_runs_chat_run_id_started_at_index').on(table.chatRunId, table.startedAt),
    index('agent_runs_review_document_id_index').on(table.reviewDocumentId),
    index('agent_runs_resume_pdf_import_task_id_index').on(table.resumePdfImportTaskId),
    index('agent_runs_action_strategy_snapshot_id_index').on(table.actionStrategySnapshotId),
  ],
).enableRLS()

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
    /** 归档只影响日常展示；有效评估仍可继续参与能力画像。 */
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'string' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('interview_sessions_opportunity_id_index').on(table.opportunityId),
    index('interview_sessions_status_index').on(table.status),
    index('interview_sessions_updated_at_index').on(table.updatedAt),
    index('interview_sessions_archived_at_index').on(table.archivedAt),
  ],
).enableRLS()

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
).enableRLS()

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
).enableRLS()

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
).enableRLS()

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
).enableRLS()

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
).enableRLS()
