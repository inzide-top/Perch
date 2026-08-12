import { z } from 'zod'
import type { ChatJsonObject } from '@/shared/chat/schemas'
import type { InterviewRound } from '@/types/opportunity'
import type { JobOpportunityRecord } from '../../../repositories/opportunity.repository'
import type { AgentToolDefinition } from '../agent-tool'
import {
  readProvidedOpportunityId,
  resolveGlobalOpportunityTarget,
  type FindInterviewRoundsByOpportunityId,
  type FindOpportunitiesByUserId,
  type SaveInterviewReviewForUser,
  type SaveWrittenTestReviewForUser,
} from './read-tools'

const writtenTestReviewPartialInputSchema = z
  .object({
    occurredAt: z.string().datetime({ offset: true }).optional(),
    reviewNote: z.string().trim().max(50_000).optional(),
    mode: z.enum(['append', 'replace']).default('append'),
  })
  .strict()
const writtenTestReviewInputSchema = writtenTestReviewPartialInputSchema.required({ reviewNote: true })
const globalWrittenTestReviewPartialInputSchema = writtenTestReviewPartialInputSchema
  .extend({
    opportunityReference: z.string().trim().min(1).max(200).optional(),
    opportunityId: z.string().uuid().optional(),
  })
  .strict()
const globalWrittenTestReviewInputSchema = globalWrittenTestReviewPartialInputSchema.required({
  opportunityId: true,
  reviewNote: true,
})
const writtenTestReviewExecutionContextSchema = z
  .object({
    opportunityId: z.string().uuid(),
    expectedUpdatedAt: z.string().min(1),
    requestedOccurredAt: z.string().datetime({ offset: true }).nullable(),
    savedOccurredAt: z.string().datetime({ offset: true }).nullable(),
    requestedReviewNote: z.string().trim().min(1).max(50_000),
    savedReviewNote: z.string().trim().min(1).max(100_000),
    mode: z.enum(['append', 'replace']),
  })
  .strict()

function normalizeReviewDateTime(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function extractWrittenTestReviewProvidedValue(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const record = value as ChatJsonObject
  const reviewValue = {
    ...('occurredAt' in record ? { occurredAt: record.occurredAt } : {}),
    ...('reviewNote' in record ? { reviewNote: record.reviewNote } : {}),
    ...('mode' in record ? { mode: record.mode } : {}),
  }
  if (Object.keys(reviewValue).length === 0) return undefined

  return writtenTestReviewPartialInputSchema.parse(reviewValue)
}

export function createWrittenTestReviewTool(
  userId: string,
  opportunity: JobOpportunityRecord,
  saveWrittenTestReviewForUser: SaveWrittenTestReviewForUser,
): AgentToolDefinition {
  return {
    name: 'save_written_test_review',
    version: '1',
    description:
      '保存或补充当前绑定机会的真实笔试复盘。用户明确要求记录、补充或修改已经发生的笔试复盘时调用。复盘正文缺失也必须调用并省略 reviewNote，产品会展示输入卡片；未来笔试安排不使用该工具。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        occurredAt: {
          type: 'string',
          format: 'date-time',
          description: '可选的真实笔试时间，使用带时区的 ISO 8601；用户没有明确说明时省略。',
        },
        reviewNote: {
          type: 'string',
          maxLength: 50_000,
          description: '用户明确提供的复盘原文。不要替用户编造未说过的问题、回答或结论。',
        },
        mode: {
          type: 'string',
          enum: ['append', 'replace'],
          description:
            'append 表示追加到已有复盘；replace 表示替换已有复盘。用户说“补充/追加”时用 append，说“改成/替换”时用 replace；不明确时优先 append。',
          default: 'append',
        },
      },
    },
    inputValidator: writtenTestReviewInputSchema,
    requiresConfirmation: true,
    prepareInput: (input, providedValue) => {
      const provided =
        providedValue && typeof providedValue === 'object' && !Array.isArray(providedValue)
          ? (providedValue as ChatJsonObject)
          : {}
      const partial = writtenTestReviewPartialInputSchema.parse({ ...input, ...provided })
      if (!partial.reviewNote?.trim()) {
        return {
          status: 'waiting_input',
          input: partial,
          missingArguments: ['reviewNote'],
          presentation: {
            kind: 'review_input',
            sourceType: 'written_test',
            sourceLabel: '笔试复盘',
            title: '补充笔试复盘',
            opportunityId: opportunity.id,
            company: opportunity.company,
            jobTitle: opportunity.jobTitle,
            target: { type: 'opportunity', id: opportunity.id, label: '当前机会的笔试复盘' },
            targetOptions: [],
            missingArguments: ['reviewNote'],
            values: partial,
          },
        }
      }

      return { status: 'ready', input: writtenTestReviewInputSchema.parse(partial) }
    },
    prepareConfirmation: (input) => {
      const review = writtenTestReviewInputSchema.parse(input)
      const existingReviewNote = opportunity.writtenTestReviewNote?.trim() ?? ''
      const requestedReviewNote = review.reviewNote.trim()
      const savedReviewNote =
        review.mode === 'append' && existingReviewNote
          ? `${existingReviewNote.trimEnd()}\n\n${requestedReviewNote}`
          : requestedReviewNote
      const requestedOccurredAt = normalizeReviewDateTime(review.occurredAt)
      const savedOccurredAt = requestedOccurredAt ?? normalizeReviewDateTime(opportunity.writtenTestScheduledAt)

      return {
        presentation: {
          kind: 'review_save',
          sourceType: 'written_test',
          sourceLabel: '笔试复盘',
          title: existingReviewNote ? '更新笔试复盘' : '保存笔试复盘',
          opportunityId: opportunity.id,
          company: opportunity.company,
          jobTitle: opportunity.jobTitle,
          target: { type: 'opportunity', id: opportunity.id, label: '当前机会的笔试复盘' },
          occurredAt: savedOccurredAt,
          reviewNote: requestedReviewNote,
          mode: review.mode,
          replacingExisting: Boolean(existingReviewNote && review.mode === 'replace'),
          result: null,
          completesPlannedRound: false,
        },
        executionContext: {
          opportunityId: opportunity.id,
          expectedUpdatedAt: opportunity.updatedAt,
          requestedOccurredAt,
          savedOccurredAt,
          requestedReviewNote,
          savedReviewNote,
          mode: review.mode,
        },
      }
    },
    execute: async (input, context): Promise<ChatJsonObject> => {
      const review = writtenTestReviewInputSchema.parse(input)
      const trustedContext = writtenTestReviewExecutionContextSchema.parse(context.confirmationContext)
      if (
        review.reviewNote.trim() !== trustedContext.requestedReviewNote ||
        review.mode !== trustedContext.mode ||
        normalizeReviewDateTime(review.occurredAt) !== trustedContext.requestedOccurredAt
      ) {
        throw new Error('确认时的笔试复盘与工具参数不一致')
      }
      if (context.signal.aborted) throw new Error('保存笔试复盘已取消')

      const result = await saveWrittenTestReviewForUser({
        opportunityId: trustedContext.opportunityId,
        userId,
        expectedUpdatedAt: trustedContext.expectedUpdatedAt,
        scheduledAt: trustedContext.savedOccurredAt,
        reviewNote: trustedContext.savedReviewNote,
      })
      return {
        status: 'saved',
        sourceType: 'written_test',
        opportunityId: result.opportunity.id,
        reviewedAt: result.opportunity.writtenTestReviewedAt,
        alreadyApplied: result.alreadyApplied,
      }
    },
  }
}

export function createGlobalWrittenTestReviewTool(
  userId: string,
  findOpportunitiesByUserId: FindOpportunitiesByUserId,
  saveWrittenTestReviewForUser: SaveWrittenTestReviewForUser,
): AgentToolDefinition {
  return {
    name: 'save_written_test_review',
    version: '1',
    description:
      '保存或补充某一个已保存机会的真实笔试复盘。使用 opportunityReference 指向公司、岗位或“公司 + 岗位”；目标缺失或同名时仍然调用，产品会先让用户选择。复盘正文缺失时也要调用并省略，产品会继续展示复盘表单。未来笔试安排不使用该工具。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        opportunityReference: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
          description: '用户原话中的公司、岗位或“公司 + 岗位”；没有明确目标时省略，不要编造数据库 ID。',
        },
        occurredAt: {
          type: 'string',
          format: 'date-time',
          description: '可选的真实笔试时间，使用带时区的 ISO 8601；用户没有明确说明时省略。',
        },
        reviewNote: {
          type: 'string',
          maxLength: 50_000,
          description: '用户明确提供的复盘原文。不要替用户编造未说过的问题、回答或结论。',
        },
        mode: {
          type: 'string',
          enum: ['append', 'replace'],
          description: 'append 追加已有复盘，replace 替换已有复盘；不明确时使用 append。',
          default: 'append',
        },
      },
    },
    inputValidator: globalWrittenTestReviewInputSchema,
    requiresConfirmation: true,
    prepareInput: async (input, providedValue, context) => {
      const providedOpportunityId = readProvidedOpportunityId(providedValue)
      const providedReview = extractWrittenTestReviewProvidedValue(providedValue)
      const partial = globalWrittenTestReviewPartialInputSchema.parse({
        ...input,
        ...(providedOpportunityId ? { opportunityId: providedOpportunityId } : {}),
        ...providedReview,
      })
      const resolution = await resolveGlobalOpportunityTarget({
        partialInput: partial,
        providedValue,
        findOpportunitiesByUserId,
        userId,
        signal: context.signal,
        title: '选择要记录笔试复盘的机会',
        description: '请选择本次笔试复盘所属的机会。确定目标并确认复盘前不会写入任何数据。',
      })
      if (resolution.status === 'waiting_input') return resolution
      if (!resolution.opportunity.includeWrittenTest) {
        throw new Error('目标机会未开启笔试流程，不能保存笔试复盘')
      }

      const { opportunityReference, opportunityId: _opportunityId, ...reviewInput } = partial
      const localTool = createWrittenTestReviewTool(userId, resolution.opportunity, saveWrittenTestReviewForUser)
      if (!localTool.prepareInput) throw new Error('笔试复盘工具缺少内容补全逻辑')
      const reviewPreparation = await localTool.prepareInput(reviewInput, providedReview, context)
      const preparedInput = {
        ...(opportunityReference ? { opportunityReference } : {}),
        opportunityId: resolution.opportunity.id,
        ...reviewPreparation.input,
      }
      if (reviewPreparation.status === 'waiting_input') {
        return { ...reviewPreparation, input: preparedInput }
      }
      return { status: 'ready', input: globalWrittenTestReviewInputSchema.parse(preparedInput) }
    },
    prepareConfirmation: async (input, context) => {
      const parsed = globalWrittenTestReviewInputSchema.parse(input)
      if (context.signal.aborted) throw new Error('保存笔试复盘已取消')
      const opportunities = await findOpportunitiesByUserId(userId)
      const opportunity = opportunities.find((item) => item.id === parsed.opportunityId)
      if (!opportunity) throw new Error('目标机会不存在或不属于当前用户')
      if (!opportunity.includeWrittenTest) throw new Error('目标机会未开启笔试流程，不能保存笔试复盘')

      const { opportunityReference: _reference, opportunityId: _opportunityId, ...reviewInput } = parsed
      const localTool = createWrittenTestReviewTool(userId, opportunity, saveWrittenTestReviewForUser)
      if (!localTool.prepareConfirmation) throw new Error('笔试复盘工具缺少确认准备逻辑')
      return localTool.prepareConfirmation(writtenTestReviewInputSchema.parse(reviewInput), context)
    },
    execute: async (input, context) => {
      const parsed = globalWrittenTestReviewInputSchema.parse(input)
      const trustedContext = writtenTestReviewExecutionContextSchema.parse(context.confirmationContext)
      if (parsed.opportunityId !== trustedContext.opportunityId) {
        throw new Error('确认时的目标机会与笔试复盘不一致')
      }
      if (context.signal.aborted) throw new Error('保存笔试复盘已取消')
      const opportunities = await findOpportunitiesByUserId(userId)
      const opportunity = opportunities.find((item) => item.id === parsed.opportunityId)
      if (!opportunity) throw new Error('目标机会不存在或不属于当前用户')
      if (!opportunity.includeWrittenTest) throw new Error('目标机会未开启笔试流程，不能保存笔试复盘')

      const { opportunityReference: _reference, opportunityId: _opportunityId, ...reviewInput } = parsed
      return createWrittenTestReviewTool(userId, opportunity, saveWrittenTestReviewForUser).execute(
        writtenTestReviewInputSchema.parse(reviewInput),
        context,
      )
    },
  }
}

const interviewReviewPartialInputSchema = z
  .object({
    roundId: z.string().uuid().optional(),
    roundReference: z.string().trim().min(1).max(100).optional(),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    reviewNote: z.string().trim().max(50_000).optional(),
    mode: z.enum(['append', 'replace']).default('append'),
    result: z.enum(['passed', 'failed', 'unknown']).optional(),
  })
  .strict()
const interviewReviewInputSchema = interviewReviewPartialInputSchema.required({
  roundId: true,
  reviewNote: true,
  result: true,
})
const globalInterviewReviewPartialInputSchema = interviewReviewPartialInputSchema
  .extend({
    opportunityReference: z.string().trim().min(1).max(200).optional(),
    opportunityId: z.string().uuid().optional(),
  })
  .strict()
const globalInterviewReviewInputSchema = globalInterviewReviewPartialInputSchema.required({
  opportunityId: true,
  roundId: true,
  reviewNote: true,
  result: true,
})
const interviewReviewExecutionContextSchema = z
  .object({
    opportunityId: z.string().uuid(),
    roundId: z.string().uuid(),
    expectedRoundUpdatedAt: z.string().min(1),
    requestedOccurredAt: z.string().datetime({ offset: true }).nullable(),
    savedOccurredAt: z.string().datetime({ offset: true }).nullable(),
    requestedReviewNote: z.string().trim().min(1).max(50_000),
    savedReviewNote: z.string().trim().min(1).max(100_000),
    mode: z.enum(['append', 'replace']),
    result: z.enum(['passed', 'failed', 'unknown']),
  })
  .strict()

function isReviewableInterviewRound(round: InterviewRound, now = Date.now()) {
  if (round.status === 'completed') return true
  if (round.status !== 'planned' || !round.scheduledAt) return false
  const scheduledAt = new Date(round.scheduledAt).getTime()
  return Number.isFinite(scheduledAt) && scheduledAt <= now
}

function formatInterviewRoundTarget(round: InterviewRound) {
  const time = round.scheduledAt
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(round.scheduledAt))
    : '时间未记录'
  return `第 ${round.sequence} 轮 · ${round.title} · ${time}`
}

function findReferencedInterviewRound(rounds: InterviewRound[], roundReference?: string) {
  if (!roundReference) return null
  const normalizedReference = roundReference.replace(/\s+/g, '').toLocaleLowerCase('zh-CN')
  const matched = rounds.filter((round) => {
    const candidates = [round.title, `第${round.sequence}轮`, `${round.sequence}面`]
    return candidates.some((candidate) =>
      candidate.replace(/\s+/g, '').toLocaleLowerCase('zh-CN').includes(normalizedReference),
    )
  })
  return matched.length === 1 ? matched[0] : null
}

function extractInterviewReviewProvidedValue(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const record = value as ChatJsonObject
  const reviewValue = {
    ...('roundId' in record ? { roundId: record.roundId } : {}),
    ...('roundReference' in record ? { roundReference: record.roundReference } : {}),
    ...('occurredAt' in record ? { occurredAt: record.occurredAt } : {}),
    ...('reviewNote' in record ? { reviewNote: record.reviewNote } : {}),
    ...('mode' in record ? { mode: record.mode } : {}),
    ...('result' in record ? { result: record.result } : {}),
  }
  if (Object.keys(reviewValue).length === 0) return undefined

  return interviewReviewPartialInputSchema.parse(reviewValue)
}

export function createInterviewReviewTool(
  userId: string,
  opportunity: JobOpportunityRecord,
  findInterviewRoundsByOpportunityId: FindInterviewRoundsByOpportunityId,
  saveInterviewReviewForUser: SaveInterviewReviewForUser,
): AgentToolDefinition {
  return {
    name: 'save_interview_review',
    version: '1',
    description:
      '保存或补充当前绑定机会中某一轮已经发生的真实面试复盘。可用 roundReference 表达“一面、二面、HR 面”等自然名称；无法唯一确定轮次或缺少复盘正文时仍要调用，产品会让用户选择和补全。未来安排或已取消轮次不能保存复盘。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        roundReference: {
          type: 'string',
          minLength: 1,
          maxLength: 100,
          description: '用户提到的面试轮次名称，例如“一面”“项目面”“第 2 轮”；不清楚时省略。',
        },
        occurredAt: {
          type: 'string',
          format: 'date-time',
          description: '可选的实际面试时间，使用带时区的 ISO 8601；用户没有明确说明时省略。',
        },
        reviewNote: {
          type: 'string',
          maxLength: 50_000,
          description: '用户明确提供的复盘原文。不要编造未说过的问题、回答、反馈或结果。',
        },
        mode: {
          type: 'string',
          enum: ['append', 'replace'],
          description: 'append 追加已有复盘，replace 替换已有复盘；不明确时使用 append。',
          default: 'append',
        },
        result: {
          type: 'string',
          enum: ['passed', 'failed', 'unknown'],
          description: '用户明确说明面试结果时填写；不明确时省略。',
        },
      },
    },
    inputValidator: interviewReviewInputSchema,
    requiresConfirmation: true,
    prepareInput: async (input, providedValue, context) => {
      const provided =
        providedValue && typeof providedValue === 'object' && !Array.isArray(providedValue)
          ? (providedValue as ChatJsonObject)
          : {}
      const partial = interviewReviewPartialInputSchema.parse({ ...input, ...provided })
      if (context.signal.aborted) throw new Error('保存面试复盘已取消')

      const reviewableRounds = (await findInterviewRoundsByOpportunityId(opportunity.id)).filter((round) =>
        isReviewableInterviewRound(round),
      )
      if (context.signal.aborted) throw new Error('保存面试复盘已取消')
      if (reviewableRounds.length === 0) {
        throw new Error('当前机会没有已经发生或已完成的面试轮次，请先补录面试轮次')
      }

      const selectedRound = partial.roundId
        ? (reviewableRounds.find((round) => round.id === partial.roundId) ?? null)
        : findReferencedInterviewRound(reviewableRounds, partial.roundReference) ||
          (reviewableRounds.length === 1 ? reviewableRounds[0] : null)
      if (partial.roundId && !selectedRound) throw new Error('所选面试轮次不存在、尚未发生或已取消')

      const occurredAt = normalizeReviewDateTime(partial.occurredAt ?? selectedRound?.scheduledAt)
      const missingArguments: Array<'roundId' | 'occurredAt' | 'reviewNote'> = []
      if (!selectedRound) missingArguments.push('roundId')
      if (occurredAt && new Date(occurredAt).getTime() > Date.now()) missingArguments.push('occurredAt')
      if (!partial.reviewNote?.trim()) missingArguments.push('reviewNote')

      const preparedInput = {
        ...partial,
        ...(selectedRound ? { roundId: selectedRound.id } : {}),
        ...(occurredAt && new Date(occurredAt).getTime() <= Date.now() ? { occurredAt } : {}),
        ...(selectedRound
          ? { result: partial.result ?? (selectedRound.result === 'pending' ? 'unknown' : selectedRound.result) }
          : {}),
      }
      if (missingArguments.length > 0) {
        return {
          status: 'waiting_input',
          input: preparedInput,
          missingArguments,
          presentation: {
            kind: 'review_input',
            sourceType: 'interview',
            sourceLabel: '面试复盘',
            title: '补充面试复盘',
            opportunityId: opportunity.id,
            company: opportunity.company,
            jobTitle: opportunity.jobTitle,
            target: selectedRound
              ? { type: 'interview_round', id: selectedRound.id, label: formatInterviewRoundTarget(selectedRound) }
              : null,
            targetOptions: reviewableRounds.map((round) => ({
              type: 'interview_round' as const,
              id: round.id,
              label: formatInterviewRoundTarget(round),
            })),
            missingArguments,
            values: preparedInput,
          },
        }
      }

      return { status: 'ready', input: interviewReviewInputSchema.parse(preparedInput) }
    },
    prepareConfirmation: async (input, context) => {
      const review = interviewReviewInputSchema.parse(input)
      if (context.signal.aborted) throw new Error('保存面试复盘已取消')
      const round = (await findInterviewRoundsByOpportunityId(opportunity.id)).find(
        (item) => item.id === review.roundId,
      )
      if (!round || !isReviewableInterviewRound(round)) {
        throw new Error('面试轮次不存在、尚未发生或已取消')
      }

      const existingReviewNote = round.reviewNote.trim()
      const requestedReviewNote = review.reviewNote.trim()
      const savedReviewNote =
        review.mode === 'append' && existingReviewNote
          ? `${existingReviewNote.trimEnd()}\n\n${requestedReviewNote}`
          : requestedReviewNote
      const requestedOccurredAt = normalizeReviewDateTime(review.occurredAt)
      const savedOccurredAt = requestedOccurredAt ?? normalizeReviewDateTime(round.scheduledAt)
      if (savedOccurredAt && new Date(savedOccurredAt).getTime() > Date.now()) {
        throw new Error('面试复盘时间不能晚于当前时间')
      }

      return {
        presentation: {
          kind: 'review_save',
          sourceType: 'interview',
          sourceLabel: '面试复盘',
          title: existingReviewNote ? '更新面试复盘' : '保存面试复盘',
          opportunityId: opportunity.id,
          company: opportunity.company,
          jobTitle: opportunity.jobTitle,
          target: { type: 'interview_round', id: round.id, label: formatInterviewRoundTarget(round) },
          occurredAt: savedOccurredAt,
          reviewNote: requestedReviewNote,
          mode: review.mode,
          replacingExisting: Boolean(existingReviewNote && review.mode === 'replace'),
          result: review.result,
          completesPlannedRound: round.status === 'planned',
        },
        executionContext: {
          opportunityId: opportunity.id,
          roundId: round.id,
          expectedRoundUpdatedAt: round.updatedAt,
          requestedOccurredAt,
          savedOccurredAt,
          requestedReviewNote,
          savedReviewNote,
          mode: review.mode,
          result: review.result,
        },
      }
    },
    execute: async (input, context): Promise<ChatJsonObject> => {
      const review = interviewReviewInputSchema.parse(input)
      const trustedContext = interviewReviewExecutionContextSchema.parse(context.confirmationContext)
      if (
        review.roundId !== trustedContext.roundId ||
        review.reviewNote.trim() !== trustedContext.requestedReviewNote ||
        review.mode !== trustedContext.mode ||
        review.result !== trustedContext.result ||
        normalizeReviewDateTime(review.occurredAt) !== trustedContext.requestedOccurredAt
      ) {
        throw new Error('确认时的面试复盘与工具参数不一致')
      }
      if (context.signal.aborted) throw new Error('保存面试复盘已取消')

      const result = await saveInterviewReviewForUser({
        opportunityId: trustedContext.opportunityId,
        roundId: trustedContext.roundId,
        userId,
        expectedRoundUpdatedAt: trustedContext.expectedRoundUpdatedAt,
        scheduledAt: trustedContext.savedOccurredAt,
        result: trustedContext.result,
        reviewNote: trustedContext.savedReviewNote,
      })
      return {
        status: 'saved',
        sourceType: 'interview',
        opportunityId: trustedContext.opportunityId,
        roundId: result.round.id,
        roundStatus: result.round.status,
        alreadyApplied: result.alreadyApplied,
      }
    },
  }
}

export function createGlobalInterviewReviewTool(
  userId: string,
  findOpportunitiesByUserId: FindOpportunitiesByUserId,
  findInterviewRoundsByOpportunityId: FindInterviewRoundsByOpportunityId,
  saveInterviewReviewForUser: SaveInterviewReviewForUser,
): AgentToolDefinition {
  return {
    name: 'save_interview_review',
    version: '1',
    description:
      '保存或补充某一个已保存机会中已经发生或已完成轮次的真实面试复盘。使用 opportunityReference 指向机会、roundReference 指向“一面、二面、HR 面”等轮次；机会或轮次无法唯一确定、复盘正文缺失时仍然调用，产品会依次让用户选择和补全。未来安排或已取消轮次不能保存复盘。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        opportunityReference: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
          description: '用户原话中的公司、岗位或“公司 + 岗位”；没有明确目标时省略，不要编造数据库 ID。',
        },
        roundReference: {
          type: 'string',
          minLength: 1,
          maxLength: 100,
          description: '用户提到的面试轮次名称，例如“一面”“项目面”“第 2 轮”；不清楚时省略。',
        },
        occurredAt: {
          type: 'string',
          format: 'date-time',
          description: '可选的实际面试时间，使用带时区的 ISO 8601；用户没有明确说明时省略。',
        },
        reviewNote: {
          type: 'string',
          maxLength: 50_000,
          description: '用户明确提供的复盘原文。不要编造未说过的问题、回答、反馈或结果。',
        },
        mode: {
          type: 'string',
          enum: ['append', 'replace'],
          description: 'append 追加已有复盘，replace 替换已有复盘；不明确时使用 append。',
          default: 'append',
        },
        result: {
          type: 'string',
          enum: ['passed', 'failed', 'unknown'],
          description: '用户明确说明面试结果时填写；不明确时省略。',
        },
      },
    },
    inputValidator: globalInterviewReviewInputSchema,
    requiresConfirmation: true,
    prepareInput: async (input, providedValue, context) => {
      const providedOpportunityId = readProvidedOpportunityId(providedValue)
      const providedReview = extractInterviewReviewProvidedValue(providedValue)
      const partial = globalInterviewReviewPartialInputSchema.parse({
        ...input,
        ...(providedOpportunityId ? { opportunityId: providedOpportunityId } : {}),
        ...providedReview,
      })
      const resolution = await resolveGlobalOpportunityTarget({
        partialInput: partial,
        providedValue,
        findOpportunitiesByUserId,
        userId,
        signal: context.signal,
        title: '选择要记录面试复盘的机会',
        description: '请选择本次面试复盘所属的机会。确定目标和面试轮次前不会写入任何数据。',
      })
      if (resolution.status === 'waiting_input') return resolution

      const { opportunityReference, opportunityId: _opportunityId, ...reviewInput } = partial
      const localTool = createInterviewReviewTool(
        userId,
        resolution.opportunity,
        findInterviewRoundsByOpportunityId,
        saveInterviewReviewForUser,
      )
      if (!localTool.prepareInput) throw new Error('面试复盘工具缺少轮次选择和内容补全逻辑')
      const reviewPreparation = await localTool.prepareInput(reviewInput, providedReview, context)
      const preparedInput = {
        ...(opportunityReference ? { opportunityReference } : {}),
        opportunityId: resolution.opportunity.id,
        ...reviewPreparation.input,
      }
      if (reviewPreparation.status === 'waiting_input') {
        return { ...reviewPreparation, input: preparedInput }
      }
      return { status: 'ready', input: globalInterviewReviewInputSchema.parse(preparedInput) }
    },
    prepareConfirmation: async (input, context) => {
      const parsed = globalInterviewReviewInputSchema.parse(input)
      if (context.signal.aborted) throw new Error('保存面试复盘已取消')
      const opportunities = await findOpportunitiesByUserId(userId)
      const opportunity = opportunities.find((item) => item.id === parsed.opportunityId)
      if (!opportunity) throw new Error('目标机会不存在或不属于当前用户')

      const { opportunityReference: _reference, opportunityId: _opportunityId, ...reviewInput } = parsed
      const localTool = createInterviewReviewTool(
        userId,
        opportunity,
        findInterviewRoundsByOpportunityId,
        saveInterviewReviewForUser,
      )
      if (!localTool.prepareConfirmation) throw new Error('面试复盘工具缺少确认准备逻辑')
      return localTool.prepareConfirmation(interviewReviewInputSchema.parse(reviewInput), context)
    },
    execute: async (input, context) => {
      const parsed = globalInterviewReviewInputSchema.parse(input)
      const trustedContext = interviewReviewExecutionContextSchema.parse(context.confirmationContext)
      if (parsed.opportunityId !== trustedContext.opportunityId) {
        throw new Error('确认时的目标机会与面试复盘不一致')
      }
      if (context.signal.aborted) throw new Error('保存面试复盘已取消')
      const opportunities = await findOpportunitiesByUserId(userId)
      const opportunity = opportunities.find((item) => item.id === parsed.opportunityId)
      if (!opportunity) throw new Error('目标机会不存在或不属于当前用户')

      const { opportunityReference: _reference, opportunityId: _opportunityId, ...reviewInput } = parsed
      return createInterviewReviewTool(
        userId,
        opportunity,
        findInterviewRoundsByOpportunityId,
        saveInterviewReviewForUser,
      ).execute(interviewReviewInputSchema.parse(reviewInput), context)
    },
  }
}

/**
 * 按会话边界创建本轮可用工具。机会内对话不暴露跨机会搜索能力。
 */
