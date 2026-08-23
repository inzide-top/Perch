import { z } from 'zod'
import { interviewConfigurationSchema } from '../interview/schemas'

const requiredText = z.string().trim().min(1)

export const chatConversationScopeTypeSchema = z.enum(['global', 'opportunity'])
export const chatMessageRoleSchema = z.enum(['user', 'assistant'])
export const chatMessageStatusSchema = z.enum(['streaming', 'completed', 'cancelled', 'failed'])
export const chatRunStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_input',
  'waiting_confirmation',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
])
export const chatRunPhaseSchema = z.enum([
  'initializing',
  'loading_context',
  'calling_model',
  'streaming_response',
  'executing_tool',
  'finalizing',
])
export const chatRunEventTypeSchema = z.enum([
  'run_started',
  'run_phase_changed',
  'message_started',
  'message_delta',
  'message_completed',
  'tool_call_requested',
  'tool_call_started',
  'tool_call_completed',
  'tool_call_failed',
  'input_requested',
  'input_received',
  'confirmation_requested',
  'confirmation_resolved',
  'run_completed',
  'run_failed',
  'run_cancelled',
])
export const chatToolActionStatusSchema = z.enum([
  'pending',
  'running',
  'waiting_input',
  'waiting_confirmation',
  'completed',
  'failed',
  'cancelled',
])
export const chatToolUserDecisionSchema = z.enum(['approved', 'rejected', 'expired'])
export const chatCommandTypeSchema = z.enum([
  'send_message',
  'provide_input',
  'confirm_tool',
  'cancel_run',
  'retry_run',
  'edit_message',
])
export const chatCommandStatusSchema = z.enum(['accepted', 'rejected'])
export const chatArtifactTypeSchema = z.literal('markdown')
export const chatArtifactStatusSchema = z.enum(['pending', 'completed', 'failed'])

const opportunityStatusSchema = z.enum([
  'pending_apply',
  'applied',
  'written_test',
  'interviewing',
  'oc',
  'offered',
  'closed',
])
const opportunityIntentionLevelSchema = z.enum(['S', 'A', 'B', 'C'])
const interviewRoundTypeSchema = z.enum(['technical_basic', 'project', 'business', 'hr', 'manager', 'other'])
const interviewScheduleMissingArgumentSchema = z.enum(['type', 'scheduledAt'])
const mockInterviewTypeSchema = z.enum(['foundation', 'project'])
const mockInterviewScaleSchema = z.enum(['quick', 'standard', 'deep'])
const mockInterviewDifficultySchema = z.enum(['basic', 'standard', 'advanced', 'adaptive'])
const mockInterviewMissingArgumentSchema = z.enum(['type', 'scale', 'difficulty', 'referenceHistoricalWeaknesses'])
const reviewSourceTypeSchema = z.enum(['written_test', 'interview'])
const reviewSaveModeSchema = z.enum(['append', 'replace'])
const interviewReviewResultSchema = z.enum(['passed', 'failed', 'unknown'])
const reviewMissingArgumentSchema = z.enum(['roundId', 'occurredAt', 'reviewNote'])
export const opportunityContextSectionValues = [
  'profile',
  'job_analysis',
  'real_interviews',
  'mock_interviews',
] as const
export const opportunityContextSectionSchema = z.enum(opportunityContextSectionValues)

/**
 * 查询结果是消息里的展示快照，不是模型可以自行生成的普通文本。
 * 保存快照后，刷新页面不需要重新调用模型或重新查询才能恢复卡片。
 */
export const chatOpportunitySearchResultPartSchema = z
  .object({
    type: z.literal('opportunity_search_result'),
    query: z
      .object({
        keyword: z.string().trim().max(100).optional(),
        statuses: z.array(opportunityStatusSchema).max(7),
        intentionLevels: z.array(opportunityIntentionLevelSchema).max(4),
        minimumMatchScore: z.number().min(0).max(100).optional(),
        maximumMatchScore: z.number().min(0).max(100).optional(),
      })
      .strict(),
    matchedCount: z.number().int().nonnegative(),
    returnedCount: z.number().int().nonnegative().max(20),
    hasMore: z.boolean(),
    items: z
      .array(
        z
          .object({
            opportunityId: z.string().trim().min(1).max(100),
            company: requiredText.max(200),
            jobTitle: requiredText.max(200),
            status: opportunityStatusSchema,
            statusLabel: requiredText.max(40),
            intentionLevel: opportunityIntentionLevelSchema.nullable(),
            industry: z.string().trim().max(100),
            address: z.array(z.string().trim().max(100)).max(10).default([]),
            matchScore: z.number().min(0).max(100).optional(),
            updatedAt: requiredText.max(80),
          })
          .strict(),
      )
      .max(20),
  })
  .strict()

const chatOpportunityImportSourceSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('url'),
      label: requiredText.max(300),
      url: z.string().trim().url().max(2_048),
    })
    .strict(),
  z
    .object({
      type: z.literal('text'),
      label: requiredText.max(300),
      url: z.null(),
    })
    .strict(),
])

export const chatOpportunityImportPreviewSchema = z
  .object({
    source: chatOpportunityImportSourceSchema,
    sourceUrl: z.string().trim().url().max(2_048).nullable(),
    company: z.string().trim().max(300),
    jobTitle: z.string().trim().max(300),
    address: z.array(z.string().trim().min(1).max(100)).max(5),
    introduction: z.string().trim().max(50_000),
    description: z.string().trim().max(50_000),
    missingRequiredFields: z.array(z.enum(['company', 'jobTitle', 'description'])).max(3),
    warning: z.string().trim().max(1_000).nullable(),
  })
  .strict()

const chatOpportunityImportResultItemSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('ready'),
      sourceLabel: requiredText.max(300),
      sourceUrl: z.string().trim().url().max(2_048).nullable(),
      preview: chatOpportunityImportPreviewSchema,
      createdOpportunityId: z.string().uuid().nullable().default(null),
      createdAt: z.string().trim().min(1).max(80).nullable().default(null),
    })
    .strict(),
  z
    .object({
      status: z.literal('failed'),
      sourceLabel: requiredText.max(300),
      sourceUrl: z.string().trim().url().max(2_048).nullable(),
      error: requiredText.max(1_000),
    })
    .strict(),
])

/**
 * AI 助手导入只生成待审核预览，不直接写入机会表。
 * 结果随消息持久化，刷新后仍可重新打开审核工作台。
 */
export const chatOpportunityImportResultPartSchema = z
  .object({
    type: z.literal('opportunity_import_result'),
    mode: z.enum(['urls', 'text']),
    items: z.array(chatOpportunityImportResultItemSchema).min(1).max(5),
  })
  .strict()

export const chatOpportunityIntentionChangePresentationSchema = z
  .object({
    kind: z.literal('opportunity_intention_level_change'),
    title: requiredText.max(80),
    opportunityId: z.string().uuid(),
    company: requiredText.max(200),
    jobTitle: requiredText.max(200),
    before: opportunityIntentionLevelSchema,
    after: opportunityIntentionLevelSchema,
  })
  .strict()

export const chatOpportunityProfileChangePresentationSchema = z
  .object({
    kind: z.literal('opportunity_profile_change'),
    title: requiredText.max(80),
    opportunityId: z.string().uuid(),
    company: requiredText.max(200),
    jobTitle: requiredText.max(200),
    changes: z
      .array(
        z
          .object({
            field: z.enum(['intentionLevel', 'industry', 'address', 'note', 'includeWrittenTest', 'status']),
            label: requiredText.max(40),
            before: requiredText.max(2_000),
            after: requiredText.max(2_000),
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict()

export const chatOpportunityProfileBatchChangePresentationSchema = z
  .object({
    kind: z.literal('opportunity_profile_batch_change'),
    title: requiredText.max(80),
    items: z.array(chatOpportunityProfileChangePresentationSchema).min(2).max(10),
  })
  .strict()

export const chatOpportunityStatusTransitionPresentationSchema = z
  .object({
    kind: z.literal('opportunity_status_transition'),
    title: requiredText.max(80),
    opportunityId: z.string().uuid(),
    company: requiredText.max(200),
    jobTitle: requiredText.max(200),
    before: opportunityStatusSchema.exclude(['closed']),
    beforeLabel: requiredText.max(40),
    after: opportunityStatusSchema.exclude(['closed']),
    afterLabel: requiredText.max(40),
    direction: z.enum(['forward', 'backward', 'same']),
    enableWrittenTest: z.boolean(),
    warning: z.string().trim().max(300).nullable(),
  })
  .strict()

/** 终止是高风险写操作：用户可编辑原因，也可留空后直接确认。 */
export const chatOpportunityTerminationInputPresentationSchema = z
  .object({
    kind: z.literal('opportunity_termination_input'),
    title: requiredText.max(80),
    opportunityId: z.string().uuid(),
    company: requiredText.max(200),
    jobTitle: requiredText.max(200),
    fromStatus: opportunityStatusSchema.exclude(['closed']),
    fromStatusLabel: requiredText.max(40),
    values: z.object({ reasonNote: z.string().trim().max(1_000) }).strict(),
    warning: requiredText.max(300),
  })
  .strict()

const chatInterviewScheduleValuesSchema = z
  .object({
    type: interviewRoundTypeSchema.optional(),
    scheduledAt: z.string().datetime({ offset: true }).optional(),
    title: z.string().trim().max(100).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict()

/** waiting_input 阶段用于让用户补全，或核对并修改模型预填的面试安排。 */
export const chatInterviewScheduleInputPresentationSchema = z
  .object({
    kind: z.literal('interview_schedule_input'),
    title: requiredText.max(80),
    opportunityId: z.string().uuid(),
    company: requiredText.max(200),
    jobTitle: requiredText.max(200),
    missingArguments: z.array(interviewScheduleMissingArgumentSchema).max(2),
    values: chatInterviewScheduleValuesSchema,
  })
  .strict()

/** waiting_confirmation 阶段用于展示最终将要创建的面试安排。 */
export const chatInterviewScheduleCreatePresentationSchema = z
  .object({
    kind: z.literal('interview_schedule_create'),
    title: requiredText.max(80),
    opportunityId: z.string().uuid(),
    company: requiredText.max(200),
    jobTitle: requiredText.max(200),
    roundType: interviewRoundTypeSchema,
    roundTypeLabel: requiredText.max(40),
    roundTitle: requiredText.max(100),
    scheduledAt: z.string().datetime({ offset: true }),
    note: z.string().trim().max(500),
  })
  .strict()

const chatMockInterviewValuesSchema = z
  .object({
    type: mockInterviewTypeSchema.optional(),
    scale: mockInterviewScaleSchema.optional(),
    difficulty: mockInterviewDifficultySchema.optional(),
    referenceHistoricalWeaknesses: z.boolean().optional(),
  })
  .strict()

/** waiting_input 阶段用于补齐模拟面试配置，问题额度由服务端依据规模计算。 */
export const chatMockInterviewInputPresentationSchema = z
  .object({
    kind: z.literal('mock_interview_input'),
    title: requiredText.max(80),
    opportunityId: z.string().uuid(),
    company: requiredText.max(200),
    jobTitle: requiredText.max(200),
    missingArguments: z.array(mockInterviewMissingArgumentSchema).min(1).max(4),
    values: chatMockInterviewValuesSchema,
  })
  .strict()

/** waiting_confirmation 阶段展示最终配置；确认后才会创建 Session 并后台生成蓝图。 */
export const chatMockInterviewCreatePresentationSchema = z
  .object({
    kind: z.literal('mock_interview_create'),
    title: requiredText.max(80),
    opportunityId: z.string().uuid(),
    company: requiredText.max(200),
    jobTitle: requiredText.max(200),
    configuration: interviewConfigurationSchema,
    typeLabel: requiredText.max(40),
    scaleLabel: requiredText.max(40),
    difficultyLabel: requiredText.max(40),
  })
  .strict()

const chatReviewTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('opportunity'), id: z.string().uuid(), label: requiredText.max(100) }).strict(),
  z.object({ type: z.literal('interview_round'), id: z.string().uuid(), label: requiredText.max(100) }).strict(),
])

const chatReviewValuesSchema = z
  .object({
    roundId: z.string().uuid().optional(),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    reviewNote: z.string().trim().max(50_000).optional(),
    mode: reviewSaveModeSchema,
    result: interviewReviewResultSchema.optional(),
  })
  .strict()

/** waiting_input 阶段复用的真实笔试/面试复盘补全卡协议。 */
export const chatReviewInputPresentationSchema = z
  .object({
    kind: z.literal('review_input'),
    sourceType: reviewSourceTypeSchema,
    sourceLabel: requiredText.max(40),
    title: requiredText.max(80),
    opportunityId: z.string().uuid(),
    company: requiredText.max(200),
    jobTitle: requiredText.max(200),
    target: chatReviewTargetSchema.nullable(),
    targetOptions: z.array(chatReviewTargetSchema).max(20).default([]),
    missingArguments: z.array(reviewMissingArgumentSchema).min(1).max(3),
    values: chatReviewValuesSchema,
  })
  .strict()

/** waiting_confirmation 阶段复用的真实笔试/面试复盘保存确认协议。 */
export const chatReviewSavePresentationSchema = z
  .object({
    kind: z.literal('review_save'),
    sourceType: reviewSourceTypeSchema,
    sourceLabel: requiredText.max(40),
    title: requiredText.max(80),
    opportunityId: z.string().uuid(),
    company: requiredText.max(200),
    jobTitle: requiredText.max(200),
    target: chatReviewTargetSchema,
    occurredAt: z.string().datetime({ offset: true }).nullable(),
    reviewNote: requiredText.max(50_000),
    mode: reviewSaveModeSchema,
    replacingExisting: z.boolean(),
    result: interviewReviewResultSchema.nullable().default(null),
    completesPlannedRound: z.boolean().default(false),
  })
  .strict()

/** 全局对话无法唯一确定目标机会时，等待用户做一次确定性选择。 */
export const chatOpportunityTargetInputPresentationSchema = z
  .object({
    kind: z.literal('opportunity_target_input'),
    title: requiredText.max(80),
    description: requiredText.max(240).optional(),
    reason: z.enum(['missing_reference', 'ambiguous_reference', 'not_found']),
    reference: z.string().trim().max(200).nullable(),
    sections: z.array(opportunityContextSectionSchema).max(4).default([]),
    candidates: z
      .array(
        z
          .object({
            opportunityId: z.string().uuid(),
            company: requiredText.max(200),
            jobTitle: requiredText.max(200),
            address: z.array(z.string().trim().max(100)).max(10).default([]),
            status: opportunityStatusSchema,
            statusLabel: requiredText.max(40),
            intentionLevel: opportunityIntentionLevelSchema.nullable(),
            updatedAt: requiredText.max(80),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()

/** 全局能力画像无法唯一确定简历主线时，等待用户选择一份已保存简历。 */
export const chatResumeTargetInputPresentationSchema = z
  .object({
    kind: z.literal('resume_target_input'),
    title: requiredText.max(80),
    description: requiredText.max(240).optional(),
    reason: z.enum(['missing_reference', 'ambiguous_reference', 'not_found']),
    reference: z.string().trim().max(200).nullable(),
    candidates: z
      .array(
        z
          .object({
            resumeId: z.string().uuid(),
            title: requiredText.max(200),
            updatedAt: requiredText.max(80),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()

/** 所有 waiting_input 展示数据的唯一入口，避免某个新工具让整条输入事件被前端丢弃。 */
export const chatToolInputPresentationSchema = z.discriminatedUnion('kind', [
  chatOpportunityTargetInputPresentationSchema,
  chatResumeTargetInputPresentationSchema,
  chatInterviewScheduleInputPresentationSchema,
  chatMockInterviewInputPresentationSchema,
  chatReviewInputPresentationSchema,
  chatOpportunityTerminationInputPresentationSchema,
])

/** SSE confirmation_requested 和历史 ToolAction 共用的机会确认卡协议。 */
export const chatOpportunityToolConfirmationPresentationSchema = z.discriminatedUnion('kind', [
  chatOpportunityIntentionChangePresentationSchema,
  chatOpportunityProfileChangePresentationSchema,
  chatOpportunityProfileBatchChangePresentationSchema,
  chatOpportunityStatusTransitionPresentationSchema,
  chatInterviewScheduleCreatePresentationSchema,
  chatMockInterviewCreatePresentationSchema,
  chatReviewSavePresentationSchema,
])

export const chatModelSnapshotSchema = z
  .object({
    modelName: requiredText.max(200),
    baseUrl: z.string().trim().url(),
  })
  .strict()

export const chatRunBudgetSchema = z
  .object({
    maxModelCalls: z.number().int().positive(),
    maxToolCalls: z.number().int().nonnegative(),
    maxInputTokens: z.number().int().positive().nullable().optional(),
    maxOutputTokens: z.number().int().positive().nullable().optional(),
  })
  .strict()

export const chatMessagePartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: requiredText }).strict(),
  z.object({ type: z.literal('tool_action'), toolActionId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('artifact'), artifactId: z.string().uuid() }).strict(),
  chatOpportunitySearchResultPartSchema,
  chatOpportunityImportResultPartSchema,
])

export const chatMessageReferenceSchema = z
  .object({
    type: z.enum(['opportunity', 'resume', 'resume_version', 'interview_session', 'interview_turn', 'artifact']),
    id: z.string().uuid(),
    label: requiredText.max(200).optional(),
  })
  .strict()

/**
 * 第一版消息引用只开放岗位机会。浏览器只提交 ID；label 必须由服务端依据当前用户数据生成，
 * 避免客户端伪造公司、岗位名称或借引用越权读取其他用户的数据。
 */
export const chatMessageReferenceInputSchema = z
  .object({
    type: z.literal('opportunity'),
    id: z.string().uuid(),
  })
  .strict()

export type ChatJsonObject = Record<string, unknown>
export type OpportunityContextSection = z.output<typeof opportunityContextSectionSchema>
export type ChatConversationScopeType = z.output<typeof chatConversationScopeTypeSchema>
export type ChatMessageRole = z.output<typeof chatMessageRoleSchema>
export type ChatMessageStatus = z.output<typeof chatMessageStatusSchema>
export type ChatRunStatus = z.output<typeof chatRunStatusSchema>
export type ChatRunPhase = z.output<typeof chatRunPhaseSchema>
export type ChatRunEventType = z.output<typeof chatRunEventTypeSchema>
export type ChatToolActionStatus = z.output<typeof chatToolActionStatusSchema>
export type ChatToolUserDecision = z.output<typeof chatToolUserDecisionSchema>
export type ChatCommandType = z.output<typeof chatCommandTypeSchema>
export type ChatCommandStatus = z.output<typeof chatCommandStatusSchema>
export type ChatArtifactType = z.output<typeof chatArtifactTypeSchema>
export type ChatArtifactStatus = z.output<typeof chatArtifactStatusSchema>
export type ChatModelSnapshot = z.output<typeof chatModelSnapshotSchema>
export type ChatRunBudget = z.output<typeof chatRunBudgetSchema>
export type ChatMessagePart = z.output<typeof chatMessagePartSchema>
export type ChatOpportunitySearchResultPart = z.output<typeof chatOpportunitySearchResultPartSchema>
export type ChatOpportunityImportPreview = z.output<typeof chatOpportunityImportPreviewSchema>
export type ChatOpportunityImportResultPart = z.output<typeof chatOpportunityImportResultPartSchema>
export type ChatOpportunityIntentionChangePresentation = z.output<
  typeof chatOpportunityIntentionChangePresentationSchema
>
export type ChatOpportunityProfileChangePresentation = z.output<typeof chatOpportunityProfileChangePresentationSchema>
export type ChatOpportunityProfileBatchChangePresentation = z.output<
  typeof chatOpportunityProfileBatchChangePresentationSchema
>
export type ChatOpportunityStatusTransitionPresentation = z.output<
  typeof chatOpportunityStatusTransitionPresentationSchema
>
export type ChatOpportunityTerminationInputPresentation = z.output<
  typeof chatOpportunityTerminationInputPresentationSchema
>
export type ChatInterviewScheduleInputPresentation = z.output<typeof chatInterviewScheduleInputPresentationSchema>
export type ChatInterviewScheduleCreatePresentation = z.output<typeof chatInterviewScheduleCreatePresentationSchema>
export type ChatMockInterviewInputPresentation = z.output<typeof chatMockInterviewInputPresentationSchema>
export type ChatMockInterviewCreatePresentation = z.output<typeof chatMockInterviewCreatePresentationSchema>
export type ChatReviewInputPresentation = z.output<typeof chatReviewInputPresentationSchema>
export type ChatReviewSavePresentation = z.output<typeof chatReviewSavePresentationSchema>
export type ChatOpportunityTargetInputPresentation = z.output<typeof chatOpportunityTargetInputPresentationSchema>
export type ChatResumeTargetInputPresentation = z.output<typeof chatResumeTargetInputPresentationSchema>
export type ChatToolInputPresentation = z.output<typeof chatToolInputPresentationSchema>
export type ChatOpportunityToolConfirmationPresentation = z.output<
  typeof chatOpportunityToolConfirmationPresentationSchema
>
export type ChatMessageReference = z.output<typeof chatMessageReferenceSchema>
export type ChatMessageReferenceInput = z.output<typeof chatMessageReferenceInputSchema>
