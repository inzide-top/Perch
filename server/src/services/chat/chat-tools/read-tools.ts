import { z } from 'zod'
import {
  opportunityContextSectionValues,
  type ChatConversationScopeType,
  type ChatJsonObject,
  type OpportunityContextSection,
} from '@/shared/chat/schemas'
import type { InterviewRound } from '@/types/opportunity'
import type { ActionStrategyOverview } from '@/types/action-strategy'
import type { CapabilityProfile } from '@/types/capability'
import type { InterviewConfiguration } from '@/shared/interview/schemas'
import type { JobOpportunityRecord } from '../../../repositories/opportunity.repository'
import type { ResumeRecord } from '../../../repositories/resume.repository'
import type {
  BatchUpdateOpportunityProfilesForUserInput,
  CreateInterviewScheduleForUserInput,
  TransitionOpportunityStatusForUserInput,
  UpdateInterviewReviewForUserInput,
  UpdateOpportunityProfileForUserInput,
  UpdateWrittenTestReviewForUserInput,
} from '../../opportunity.service'
import type { JobOpportunityBatchImportItem, JobOpportunityImportPreview } from '../../opportunity-import.service'
import type { AgentToolDefinition } from '../agent-tool'
import { resolveOpportunityTarget } from '../opportunity-target-resolver'

export const opportunityStatusSchema = z.enum([
  'pending_apply',
  'applied',
  'written_test',
  'interviewing',
  'oc',
  'offered',
  'closed',
])

export const opportunityIntentionLevelSchema = z.enum(['S', 'A', 'B', 'C'])
const importOpportunitiesFromUrlsInputSchema = z
  .object({
    urls: z.array(z.string().trim().url().max(2_048)).min(1).max(5),
  })
  .strict()
const importOpportunityFromTextInputSchema = z
  .object({
    text: z.string().trim().min(20).max(20_000),
  })
  .strict()

const searchOpportunitiesInputSchema = z
  .object({
    keyword: z.string().trim().min(1).max(100).optional(),
    statuses: z.array(opportunityStatusSchema).max(7).default([]),
    intentionLevels: z.array(opportunityIntentionLevelSchema).max(4).default([]),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict()

export const statusLabels: Record<z.output<typeof opportunityStatusSchema>, string> = {
  pending_apply: '待投递',
  applied: '已投递',
  written_test: '笔试中',
  interviewing: '面试中',
  oc: 'OC',
  offered: '已 Offer',
  closed: '已终止',
}

export type FindOpportunitiesByUserId = (userId: string) => Promise<JobOpportunityRecord[]>
export type FindResumesByUserId = (userId: string) => Promise<ResumeRecord[]>
export type GetOpportunityContextForUser = (record: {
  userId: string
  opportunityId: string
  sections: OpportunityContextSection[]
}) => Promise<ChatJsonObject>
export type GetCapabilityProfileForUser = (userId: string, resumeId?: string) => Promise<CapabilityProfile>
export type GetActionStrategyOverviewForUser = (userId: string) => Promise<ActionStrategyOverview>
export type ImportOpportunitiesFromUrls = (record: {
  urls: string[]
  signal: AbortSignal
}) => Promise<{ items: JobOpportunityBatchImportItem[] }>
export type ImportOpportunityFromText = (record: {
  text: string
  signal: AbortSignal
}) => Promise<JobOpportunityImportPreview>
export type OpportunityMutationResult = Promise<{ opportunity: JobOpportunityRecord; alreadyApplied: boolean }>
export type UpdateOpportunityProfileForUser = (
  record: UpdateOpportunityProfileForUserInput,
) => OpportunityMutationResult
export type BatchUpdateOpportunityProfilesForUser = (
  record: BatchUpdateOpportunityProfilesForUserInput,
) => Promise<{ opportunities: JobOpportunityRecord[]; alreadyApplied: boolean }>
export type TransitionOpportunityStatusForUser = (
  record: TransitionOpportunityStatusForUserInput,
) => OpportunityMutationResult
export type CreateInterviewScheduleForUser = (
  record: CreateInterviewScheduleForUserInput,
) => Promise<{ round: { id: string; scheduledAt: string; title: string; type: string }; alreadyApplied: boolean }>
export type SaveWrittenTestReviewForUser = (
  record: Omit<UpdateWrittenTestReviewForUserInput, 'modelConnection'>,
) => Promise<{ opportunity: JobOpportunityRecord; alreadyApplied: boolean }>
export type FindInterviewRoundsByOpportunityId = (opportunityId: string) => Promise<InterviewRound[]>
export type SaveInterviewReviewForUser = (
  record: Omit<UpdateInterviewReviewForUserInput, 'modelConnection'>,
) => Promise<{ round: InterviewRound; alreadyApplied: boolean }>
export type CreateMockInterviewForUser = (record: {
  sessionId: string
  opportunityId: string
  userId: string
  configuration: InterviewConfiguration
}) => Promise<{ session: { id: string; status: string }; alreadyApplied: boolean }>

export type CreateChatToolRegistryInput = {
  userId: string
  scopeType: ChatConversationScopeType
  opportunity?: JobOpportunityRecord | null
}

export type ChatToolRegistryDependencies = {
  findOpportunitiesByUserId: FindOpportunitiesByUserId
  findResumesByUserId?: FindResumesByUserId
  getOpportunityContextForUser?: GetOpportunityContextForUser
  getCapabilityProfileForUser?: GetCapabilityProfileForUser
  getActionStrategyOverviewForUser?: GetActionStrategyOverviewForUser
  importOpportunitiesFromUrls?: ImportOpportunitiesFromUrls
  importOpportunityFromText?: ImportOpportunityFromText
  updateOpportunityProfileForUser?: UpdateOpportunityProfileForUser
  batchUpdateOpportunityProfilesForUser?: BatchUpdateOpportunityProfilesForUser
  transitionOpportunityStatusForUser?: TransitionOpportunityStatusForUser
  createInterviewScheduleForUser?: CreateInterviewScheduleForUser
  createMockInterviewForUser?: CreateMockInterviewForUser
  saveWrittenTestReviewForUser?: SaveWrittenTestReviewForUser
  findInterviewRoundsByOpportunityId?: FindInterviewRoundsByOpportunityId
  saveInterviewReviewForUser?: SaveInterviewReviewForUser
}

function includesKeyword(opportunity: JobOpportunityRecord, keyword: string) {
  const searchableText = [
    opportunity.company,
    opportunity.jobTitle,
    opportunity.industry,
    ...(opportunity.address ?? []),
  ]
    .join(' ')
    .toLocaleLowerCase('zh-CN')

  return searchableText.includes(keyword.toLocaleLowerCase('zh-CN'))
}

export function createSearchOpportunitiesTool(
  userId: string,
  findOpportunitiesByUserId: FindOpportunitiesByUserId,
): AgentToolDefinition {
  return {
    name: 'search_opportunities',
    version: '1',
    description:
      '查询当前用户已经保存的求职机会。用户询问有哪些机会、某家公司或岗位、某个求职阶段或意向等级时使用。该工具只读，不会修改机会。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        keyword: {
          type: 'string',
          description: '可选关键词，用于匹配公司、岗位、行业或工作地点。',
          minLength: 1,
          maxLength: 100,
        },
        statuses: {
          type: 'array',
          description:
            '可选求职阶段。待投递 pending_apply、已投递 applied、笔试中 written_test、面试中 interviewing、OC oc、已 Offer offered、已终止 closed。',
          items: { type: 'string', enum: opportunityStatusSchema.options },
          maxItems: 7,
          default: [],
        },
        intentionLevels: {
          type: 'array',
          description: '可选意向等级过滤。',
          items: { type: 'string', enum: opportunityIntentionLevelSchema.options },
          maxItems: 4,
          default: [],
        },
        limit: {
          type: 'integer',
          description: '最多返回多少条，默认 10，最大 20。',
          minimum: 1,
          maximum: 20,
          default: 10,
        },
      },
    },
    inputValidator: searchOpportunitiesInputSchema,
    executionFailurePolicy: 'return_to_model',
    requiresConfirmation: false,
    execute: async (input, context): Promise<ChatJsonObject> => {
      const parsed = searchOpportunitiesInputSchema.parse(input)
      if (context.signal.aborted) throw new Error('机会查询已取消')

      const opportunities = await findOpportunitiesByUserId(userId)
      if (context.signal.aborted) throw new Error('机会查询已取消')

      const matched = opportunities.filter((opportunity) => {
        if (parsed.statuses.length > 0 && !parsed.statuses.includes(opportunity.status)) return false
        if (parsed.intentionLevels.length > 0 && !parsed.intentionLevels.includes(opportunity.intentionLevel)) {
          return false
        }
        if (parsed.keyword && !includesKeyword(opportunity, parsed.keyword)) return false
        return true
      })
      const items = matched.slice(0, parsed.limit).map((opportunity) => ({
        id: opportunity.id,
        company: opportunity.company,
        jobTitle: opportunity.jobTitle,
        status: opportunity.status,
        statusLabel: statusLabels[opportunity.status],
        intentionLevel: opportunity.intentionLevel,
        industry: opportunity.industry,
        address: opportunity.address ?? [],
        updatedAt: opportunity.updatedAt,
      }))

      return {
        query: {
          ...(parsed.keyword ? { keyword: parsed.keyword } : {}),
          statuses: parsed.statuses,
          intentionLevels: parsed.intentionLevels,
        },
        matchedCount: matched.length,
        returnedCount: items.length,
        hasMore: matched.length > items.length,
        opportunities: items,
      }
    },
  }
}

const opportunityContextSectionSchema = z.enum(opportunityContextSectionValues)
const opportunityContextPartialInputSchema = z
  .object({
    opportunityReference: z.string().trim().min(1).max(200).optional(),
    opportunityId: z.string().uuid().nullable().optional(),
    sections: z.array(opportunityContextSectionSchema).min(1).max(4).optional(),
  })
  .strict()
const opportunityContextInputSchema = opportunityContextPartialInputSchema.required({
  opportunityId: true,
  sections: true,
})

export function createGetOpportunityContextTool(
  userId: string,
  findOpportunitiesByUserId: FindOpportunitiesByUserId,
  getOpportunityContextForUser: GetOpportunityContextForUser,
): AgentToolDefinition {
  return {
    name: 'get_opportunity_context',
    version: '1',
    description:
      '读取某一个已保存机会的有界详情快照。用户询问具体机会的全貌、JD 匹配结论、真实笔试/面试记录、模拟面试表现或准备建议时使用。只读，不会修改数据。若名称缺失或同名，仍然调用本工具，产品会让用户选择目标机会。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        opportunityReference: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
          description: '用户原话中的公司、岗位或“公司 + 岗位”名称；没有明确目标时省略，不要编造数据库 ID。',
        },
        sections: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          uniqueItems: true,
          items: { type: 'string', enum: opportunityContextSectionValues },
          description:
            '按问题选择最少必要内容：profile 基础资料/JD，job_analysis 匹配分析，real_interviews 真实笔试面试记录，mock_interviews 模拟面试摘要。用户询问全貌时可选四项。',
        },
      },
    },
    inputValidator: opportunityContextInputSchema,
    executionFailurePolicy: 'return_to_model',
    requiresConfirmation: false,
    prepareInput: async (input, providedValue, context) => {
      const providedOpportunityId =
        providedValue &&
        typeof providedValue === 'object' &&
        !Array.isArray(providedValue) &&
        typeof (providedValue as ChatJsonObject).opportunityId === 'string'
          ? (providedValue as ChatJsonObject).opportunityId
          : undefined
      const partial = opportunityContextPartialInputSchema.parse({
        ...input,
        ...(providedOpportunityId ? { opportunityId: providedOpportunityId } : {}),
      })
      if (context.signal.aborted) throw new Error('读取机会信息已取消')

      const opportunities = await findOpportunitiesByUserId(userId)
      if (context.signal.aborted) throw new Error('读取机会信息已取消')
      const sections = partial.sections ?? [...opportunityContextSectionValues]
      if (opportunities.length === 0) {
        return {
          status: 'ready',
          input: {
            ...(partial.opportunityReference ? { opportunityReference: partial.opportunityReference } : {}),
            opportunityId: null,
            sections,
          },
        }
      }

      const resolution = resolveOpportunityTarget({
        opportunities,
        reference: partial.opportunityReference,
        selectedOpportunityId: partial.opportunityId ?? undefined,
      })
      if (resolution.status === 'resolved') {
        return {
          status: 'ready',
          input: {
            ...(partial.opportunityReference ? { opportunityReference: partial.opportunityReference } : {}),
            opportunityId: resolution.opportunity.id,
            sections,
          },
        }
      }

      return {
        status: 'waiting_input',
        input: {
          ...(partial.opportunityReference ? { opportunityReference: partial.opportunityReference } : {}),
          sections,
        },
        missingArguments: ['opportunityId'],
        presentation: {
          kind: 'opportunity_target_input',
          title: '选择目标机会',
          reason: resolution.reason,
          reference: partial.opportunityReference ?? null,
          sections,
          candidates: resolution.candidates.map((opportunity) => ({
            opportunityId: opportunity.id,
            company: opportunity.company,
            jobTitle: opportunity.jobTitle,
            status: opportunity.status,
            statusLabel: statusLabels[opportunity.status],
            intentionLevel: opportunity.intentionLevel,
            updatedAt: opportunity.updatedAt,
          })),
        },
      }
    },
    execute: async (input, context) => {
      const parsed = opportunityContextInputSchema.parse(input)
      if (context.signal.aborted) throw new Error('读取机会信息已取消')
      if (parsed.opportunityId === null) {
        return {
          status: 'empty',
          message: '当前用户还没有保存任何求职机会。',
          requestedSections: parsed.sections,
        }
      }
      const result = await getOpportunityContextForUser({
        userId,
        opportunityId: parsed.opportunityId,
        sections: parsed.sections,
      })
      if (context.signal.aborted) throw new Error('读取机会信息已取消')
      return result
    },
  }
}

export function readProvidedOpportunityId(providedValue: unknown) {
  if (!providedValue || typeof providedValue !== 'object' || Array.isArray(providedValue)) return undefined
  const opportunityId = (providedValue as ChatJsonObject).opportunityId
  return typeof opportunityId === 'string' ? opportunityId : undefined
}

export async function resolveGlobalOpportunityTarget(input: {
  partialInput: ChatJsonObject & { opportunityReference?: string; opportunityId?: string }
  providedValue: unknown
  findOpportunitiesByUserId: FindOpportunitiesByUserId
  userId: string
  signal: AbortSignal
  title: string
  description: string
}) {
  if (input.signal.aborted) throw new Error('选择目标机会已取消')
  const opportunities = await input.findOpportunitiesByUserId(input.userId)
  if (input.signal.aborted) throw new Error('选择目标机会已取消')
  if (opportunities.length === 0) throw new Error('当前还没有可操作的求职机会')

  const resolution = resolveOpportunityTarget({
    opportunities,
    reference: input.partialInput.opportunityReference,
    selectedOpportunityId: readProvidedOpportunityId(input.providedValue) ?? input.partialInput.opportunityId,
  })
  if (resolution.status === 'resolved') return resolution

  return {
    status: 'waiting_input' as const,
    input: input.partialInput,
    missingArguments: ['opportunityId'],
    presentation: {
      kind: 'opportunity_target_input',
      title: input.title,
      description: input.description,
      reason: resolution.reason,
      reference: input.partialInput.opportunityReference ?? null,
      sections: [],
      candidates: resolution.candidates.map((opportunity) => ({
        opportunityId: opportunity.id,
        company: opportunity.company,
        jobTitle: opportunity.jobTitle,
        status: opportunity.status,
        statusLabel: statusLabels[opportunity.status],
        intentionLevel: opportunity.intentionLevel,
        updatedAt: opportunity.updatedAt,
      })),
    },
  }
}

const capabilityProfilePartialInputSchema = z
  .object({
    resumeReference: z.string().trim().min(1).max(200).optional(),
    resumeId: z.string().uuid().nullable().optional(),
  })
  .strict()
const capabilityProfileInputSchema = capabilityProfilePartialInputSchema.required({ resumeId: true })

function readProvidedResumeId(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const resumeId = (value as ChatJsonObject).resumeId
  return typeof resumeId === 'string' ? resumeId : undefined
}

function normalizeResumeReference(value: string) {
  return value.replace(/\s+/g, '').toLocaleLowerCase('zh-CN')
}

function resolveResumeTarget(input: { resumes: ResumeRecord[]; reference?: string; selectedResumeId?: string }):
  | { status: 'resolved'; resume: ResumeRecord }
  | {
      status: 'waiting_input'
      reason: 'missing_reference' | 'ambiguous_reference' | 'not_found'
      candidates: ResumeRecord[]
    } {
  if (input.selectedResumeId) {
    const selected = input.resumes.find((resume) => resume.id === input.selectedResumeId)
    if (selected) return { status: 'resolved', resume: selected }
    return { status: 'waiting_input', reason: 'not_found', candidates: input.resumes }
  }

  if (!input.reference) {
    if (input.resumes.length === 1) return { status: 'resolved', resume: input.resumes[0]! }
    return { status: 'waiting_input', reason: 'missing_reference', candidates: input.resumes }
  }

  const normalizedReference = normalizeResumeReference(input.reference)
  const exactMatches = input.resumes.filter((resume) => normalizeResumeReference(resume.title) === normalizedReference)
  if (exactMatches.length === 1) return { status: 'resolved', resume: exactMatches[0]! }

  const fuzzyMatches = input.resumes.filter((resume) => {
    const normalizedTitle = normalizeResumeReference(resume.title)
    return normalizedTitle.includes(normalizedReference) || normalizedReference.includes(normalizedTitle)
  })
  if (fuzzyMatches.length === 1) return { status: 'resolved', resume: fuzzyMatches[0]! }

  const candidates = exactMatches.length > 0 ? exactMatches : fuzzyMatches.length > 0 ? fuzzyMatches : input.resumes
  return {
    status: 'waiting_input',
    reason:
      candidates.length > 1 && (exactMatches.length > 0 || fuzzyMatches.length > 0)
        ? 'ambiguous_reference'
        : 'not_found',
    candidates,
  }
}

function toBoundedCapabilityProfile(profile: CapabilityProfile): ChatJsonObject {
  return {
    status: profile.dataStatus === 'empty' ? 'empty' : 'ready',
    generatedAt: profile.generatedAt,
    dataStatus: profile.dataStatus,
    resume: profile.scope
      ? {
          resumeId: profile.scope.resumeId,
          title: profile.scope.resumeTitle,
          currentVersionNumber: profile.scope.currentVersionNumber,
          targetDirection: profile.scope.targetDirection,
        }
      : null,
    sourceCounts: profile.sourceCounts,
    stableStrengths: profile.interview.strengths.slice(0, 5).map((item) => ({
      capabilityKey: item.capabilityKey,
      label: item.label,
      evidenceCount: item.evidenceCount,
      sourceCount: item.sourceCount,
      confidence: item.confidence,
      lastObservedAt: item.lastObservedAt,
      references: item.references.slice(0, 5),
    })),
    improvementAreas: profile.interview.weaknesses.slice(0, 5).map((item) => ({
      capabilityKey: item.capabilityKey,
      label: item.label,
      evidenceCount: item.evidenceCount,
      sourceCount: item.sourceCount,
      confidence: item.confidence,
      lastObservedAt: item.lastObservedAt,
      references: item.references.slice(0, 5),
    })),
    historicalWeaknesses: profile.interview.historicalWeaknesses.slice(0, 5),
    jdEvidence: profile.jdSignals.slice(0, 5).map((signal) => ({
      opportunityId: signal.opportunityId,
      company: signal.company,
      jobTitle: signal.jobTitle,
      isCurrentResumeVersion: signal.isCurrentVersion,
      matchScore: signal.matchScore,
      recommendation: signal.recommendation,
      strengths: signal.strengths.slice(0, 2).map((item) => ({
        title: item.title,
        level: item.level,
        reason: item.reason,
      })),
      gaps: signal.gaps.slice(0, 2).map((item) => ({
        title: item.title,
        level: item.level,
        reason: item.reason,
      })),
      updatedAt: signal.updatedAt,
    })),
  }
}

export function createGetCapabilityProfileTool(
  userId: string,
  findResumesByUserId: FindResumesByUserId,
  getCapabilityProfileForUser: GetCapabilityProfileForUser,
): AgentToolDefinition {
  return {
    name: 'get_capability_profile',
    version: '1',
    description:
      '读取当前用户跨机会汇总的能力画像，包括稳定优势、待补强项、历史薄弱项和有界证据来源。用户询问整体能力、长期优势或普遍短板时使用；询问某一个具体机会的优势时改用 get_opportunity_context。存在多份简历且无法唯一确定时仍然调用，产品会让用户选择。该工具只读，不会重新分析简历或调用模型生成新画像。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        resumeReference: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
          description: '用户明确提到的简历名称；没有明确说明时省略，不要编造数据库 ID。',
        },
      },
    },
    inputValidator: capabilityProfileInputSchema,
    executionFailurePolicy: 'return_to_model',
    requiresConfirmation: false,
    prepareInput: async (input, providedValue, context) => {
      const selectedResumeId = readProvidedResumeId(providedValue)
      const partial = capabilityProfilePartialInputSchema.parse({
        ...input,
        ...(selectedResumeId ? { resumeId: selectedResumeId } : {}),
      })
      if (context.signal.aborted) throw new Error('读取能力画像已取消')
      const resumes = await findResumesByUserId(userId)
      if (context.signal.aborted) throw new Error('读取能力画像已取消')
      if (resumes.length === 0) {
        return {
          status: 'ready',
          input: {
            ...(partial.resumeReference ? { resumeReference: partial.resumeReference } : {}),
            resumeId: null,
          },
        }
      }

      const resolution = resolveResumeTarget({
        resumes,
        reference: partial.resumeReference,
        selectedResumeId: partial.resumeId ?? undefined,
      })
      if (resolution.status === 'resolved') {
        return {
          status: 'ready',
          input: {
            ...(partial.resumeReference ? { resumeReference: partial.resumeReference } : {}),
            resumeId: resolution.resume.id,
          },
        }
      }

      return {
        status: 'waiting_input',
        input: partial,
        missingArguments: ['resumeId'],
        presentation: {
          kind: 'resume_target_input',
          title: '选择能力画像使用的简历',
          description: '能力画像按简历主线聚合，请选择本次问题对应的简历。选择前不会重新分析或生成数据。',
          reason: resolution.reason,
          reference: partial.resumeReference ?? null,
          candidates: resolution.candidates.slice(0, 20).map((resume) => ({
            resumeId: resume.id,
            title: resume.title,
            updatedAt: resume.updatedAt,
          })),
        },
      }
    },
    execute: async (input, context) => {
      const parsed = capabilityProfileInputSchema.parse(input)
      if (context.signal.aborted) throw new Error('读取能力画像已取消')
      if (parsed.resumeId === null) {
        return {
          status: 'empty',
          dataStatus: 'empty',
          message: '当前用户还没有简历，暂时无法生成能力画像。',
          stableStrengths: [],
          improvementAreas: [],
          historicalWeaknesses: [],
          jdEvidence: [],
        }
      }

      const profile = await getCapabilityProfileForUser(userId, parsed.resumeId)
      if (context.signal.aborted) throw new Error('读取能力画像已取消')
      return toBoundedCapabilityProfile(profile)
    },
  }
}

const actionStrategyInputSchema = z.object({}).strict()

function toBoundedActionStrategy(overview: ActionStrategyOverview): ChatJsonObject {
  return {
    status: overview.actions.length > 0 || overview.capabilityActions.length > 0 ? 'ready' : 'empty',
    generatedAt: overview.generatedAt,
    sourceSummary: overview.sourceSummary,
    actions: overview.actions.slice(0, 10).map((action) => ({
      key: action.key,
      type: action.type,
      priority: action.priority,
      title: action.title,
      reason: action.reason,
      suggestedStep: action.suggestedStep,
      evidence: action.evidence.slice(0, 3),
      ...(action.opportunityId ? { opportunityId: action.opportunityId } : {}),
      ...(action.company ? { company: action.company } : {}),
      ...(action.jobTitle ? { jobTitle: action.jobTitle } : {}),
      ...(action.status ? { opportunityStatus: action.status } : {}),
      ...(action.intentionLevel ? { intentionLevel: action.intentionLevel } : {}),
      ...(action.matchScore !== undefined ? { matchScore: action.matchScore } : {}),
      ...(action.waitingStage ? { waitingStage: action.waitingStage } : {}),
      cta: action.cta,
    })),
    capabilityActions: overview.capabilityActions.slice(0, 5).map((action) => ({
      key: action.key,
      type: action.type,
      priority: action.priority,
      title: action.title,
      reason: action.reason,
      suggestedStep: action.suggestedStep,
      evidence: action.evidence.slice(0, 3),
      capabilityKey: action.capabilityKey,
      capabilityLabel: action.capabilityLabel,
      confidence: action.confidence,
      cta: action.cta,
    })),
    ai: {
      freshness: overview.ai.freshness,
      status: overview.ai.status,
      modelName: overview.ai.modelName,
      generatedAt: overview.ai.generatedAt,
      expiresAt: overview.ai.expiresAt,
      staleReasons: overview.ai.staleReasons,
      summary: overview.ai.summary
        ? {
            headline: overview.ai.summary.headline,
            summary: overview.ai.summary.summary,
            selectedActions: overview.ai.summary.selectedActions.slice(0, 5),
            capabilityFocus: overview.ai.summary.capabilityFocus.slice(0, 5),
          }
        : null,
      error: overview.ai.error,
    },
  }
}

export function createGetActionStrategyTool(
  userId: string,
  getActionStrategyOverviewForUser: GetActionStrategyOverviewForUser,
): AgentToolDefinition {
  return {
    name: 'get_action_strategy',
    version: '1',
    description:
      '读取当前用户跨机会的行动策略，包括待跟进机会、待投递任务、临近笔试面试准备、待补记录和能力训练任务。用户询问今天做什么、下一步求职安排、哪些机会需要跟进时使用。该工具只读，只返回当前确定性策略和已有 AI 快照的新鲜度，不会触发新的付费策略生成。',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    inputValidator: actionStrategyInputSchema,
    executionFailurePolicy: 'return_to_model',
    requiresConfirmation: false,
    execute: async (input, context) => {
      actionStrategyInputSchema.parse(input)
      if (context.signal.aborted) throw new Error('读取行动策略已取消')
      const overview = await getActionStrategyOverviewForUser(userId)
      if (context.signal.aborted) throw new Error('读取行动策略已取消')
      return toBoundedActionStrategy(overview)
    },
  }
}

function getImportUrlLabel(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export function createImportOpportunitiesFromUrlsTool(
  importOpportunitiesFromUrls: ImportOpportunitiesFromUrls,
): AgentToolDefinition {
  return {
    name: 'import_opportunities_from_urls',
    version: '1',
    description:
      '从 1 到 5 个公开岗位网页中提取待审核的 JD 信息。只有用户明确要求导入、添加或识别这些岗位网址时使用。该工具只生成预览，不会创建机会或启动 JD 分析；部分网址失败时仍保留其他成功结果。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['urls'],
      properties: {
        urls: {
          type: 'array',
          description: '用户原文中明确给出的完整 http 或 https 岗位网址，保持原顺序，一次最多 5 条。',
          items: { type: 'string', format: 'uri', maxLength: 2_048 },
          minItems: 1,
          maxItems: 5,
        },
      },
    },
    inputValidator: importOpportunitiesFromUrlsInputSchema,
    requiresConfirmation: false,
    execute: async (input, context) => {
      const parsed = importOpportunitiesFromUrlsInputSchema.parse(input)
      if (context.signal.aborted) throw new Error('岗位网页导入已取消')
      const result = await importOpportunitiesFromUrls({ urls: parsed.urls, signal: context.signal })
      if (context.signal.aborted) throw new Error('岗位网页导入已取消')

      return {
        mode: 'urls',
        items: result.items.map((item) =>
          item.status === 'ready'
            ? {
                status: 'ready',
                sourceLabel: item.preview.source.label,
                sourceUrl: item.preview.sourceUrl,
                preview: item.preview,
              }
            : {
                status: 'failed',
                sourceLabel: getImportUrlLabel(item.url),
                sourceUrl: item.url,
                error: item.error,
              },
        ),
      }
    },
  }
}

export function createImportOpportunityFromTextTool(
  importOpportunityFromText: ImportOpportunityFromText,
): AgentToolDefinition {
  return {
    name: 'import_opportunity_from_text',
    version: '1',
    description:
      '从用户粘贴的一份岗位原文中提取待审核的 JD 信息。只有用户明确要求导入、添加或识别该岗位文本时使用；一份文本只对应一个岗位。该工具只生成预览，不会创建机会或启动 JD 分析。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: {
        text: {
          type: 'string',
          description: '用户提供的完整岗位原文，不要总结、删减或改写。',
          minLength: 20,
          maxLength: 20_000,
        },
      },
    },
    inputValidator: importOpportunityFromTextInputSchema,
    requiresConfirmation: false,
    execute: async (input, context) => {
      const parsed = importOpportunityFromTextInputSchema.parse(input)
      if (context.signal.aborted) throw new Error('岗位文本导入已取消')

      try {
        const preview = await importOpportunityFromText({ text: parsed.text, signal: context.signal })
        if (context.signal.aborted) throw new Error('岗位文本导入已取消')
        return {
          mode: 'text',
          items: [
            {
              status: 'ready',
              sourceLabel: preview.source.label,
              sourceUrl: null,
              preview,
            },
          ],
        }
      } catch (error) {
        if (context.signal.aborted) throw new Error('岗位文本导入已取消', { cause: error })
        return {
          mode: 'text',
          items: [
            {
              status: 'failed',
              sourceLabel: '粘贴文本',
              sourceUrl: null,
              error: error instanceof Error ? error.message : '岗位文本识别失败，请稍后重试',
            },
          ],
        }
      }
    },
  }
}
