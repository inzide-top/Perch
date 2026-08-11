import type {
  InterviewRound,
  JobOpportunity,
  JobOpportunityStatus,
  OpportunityStatusChange,
  OpportunityTermination,
  WrittenTestReview,
  JobAnalysisListSummary,
} from '@/types/opportunity'
import {
  opportunityRepository,
  OpportunityRepositoryConflictError,
  type JobOpportunityDetail,
  type OpportunityProfilePatch,
  type JobOpportunityRecord,
} from '../repositories/opportunity.repository'
import {
  addInterviewRoundInputSchema,
  cancelInterviewRoundInputSchema,
  completeInterviewRoundInputSchema,
  createJobOpportunityInputSchema,
  terminateOpportunityInputSchema,
  updateInterviewRoundInputSchema,
  updateJobOpportunityInputSchema,
  updateJobOpportunityStatusInputSchema,
  updateWrittenTestReviewInputSchema,
  type JobOpportunityListFilters,
} from '../schemas/opportunity.schema'
import { getOpportunityRegions } from '@/shared/opportunity/geography'
import { getCurrentUserId } from '../context/current-user'
import { cancelJobAnalysisForOpportunity, getJobAnalysisListSummaries } from './job-analysis.service'
import { jobAnalysisRepository } from '../repositories/job-analysis.repository'
import { createOpportunityFingerprint } from './opportunity-fingerprint'
import { interviewRepository } from '../repositories/interview.repository'
import { reviewDocumentRepository } from '../repositories/review-document.repository'
import { queueReviewDocumentExtraction } from './review/review-document.service'
import type { ModelConnection } from '../schemas/model.schema'
import { isAllowedStatusTransition } from './opportunity-status'

type ReviewDocumentSyncInput = {
  opportunityId: string
  sourceType: 'written_test' | 'interview'
  interviewRoundId?: string
  rawText: string
  modelConnection?: ModelConnection
}

/**
 * 复盘原文已经由机会事务保存；提取只是后台副作用，不能让模型请求失败回滚用户的原文。
 * 清空原文时同步删除旧的结构化文档，避免详情页继续展示过期结果。
 */
async function syncReviewDocument(input: ReviewDocumentSyncInput) {
  const rawText = input.rawText.trim()

  if (!rawText) {
    try {
      await reviewDocumentRepository.deleteBySource(input.opportunityId, input.sourceType, input.interviewRoundId)
    } catch (error) {
      console.error('Failed to clear review document', error)
    }
    return
  }

  if (!input.modelConnection) {
    try {
      await reviewDocumentRepository.upsertPending({
        id: crypto.randomUUID(),
        opportunityId: input.opportunityId,
        sourceType: input.sourceType,
        interviewRoundId: input.interviewRoundId ?? null,
        rawText,
        updatedAt: new Date().toISOString(),
      })
    } catch (error) {
      console.error('Failed to invalidate review document', error)
    }
    return
  }

  try {
    await queueReviewDocumentExtraction({
      opportunityId: input.opportunityId,
      sourceType: input.sourceType,
      interviewRoundId: input.interviewRoundId ?? null,
      rawText,
      modelConnection: input.modelConnection,
    })
  } catch (error) {
    console.error('Failed to queue review document extraction', error)
  }
}

export class OpportunityNotFoundError extends Error {
  constructor(opportunityId: string) {
    super(`Opportunity ${opportunityId} not found`)
    this.name = 'OpportunityNotFoundError'
  }
}

class OpportunityInputError extends Error {
  statusCode = 400

  constructor(message: string) {
    super(message)
    this.name = 'OpportunityInputError'
  }
}

class OpportunityStatusConflictError extends Error {
  statusCode = 409

  constructor() {
    super('Opportunity status has changed. Please refresh and try again.')
    this.name = 'OpportunityStatusConflictError'
  }
}

class OpportunityInterviewHistoryConflictError extends Error {
  statusCode = 409

  constructor() {
    super('该机会存在模拟面试历史，当前不能直接删除')
    this.name = 'OpportunityInterviewHistoryConflictError'
  }
}

class OpportunityInterviewRoundConflictError extends Error {
  statusCode = 409

  constructor(message = '面试轮次状态已变化，请刷新后重试') {
    super(message)
    this.name = 'OpportunityInterviewRoundConflictError'
  }
}

function assertInterviewRoundState(round: Pick<InterviewRound, 'status' | 'result' | 'reviewNote' | 'keyTakeaways'>) {
  if (round.status === 'planned' && round.result !== 'pending') {
    throw new OpportunityInputError('待进行的面试结果必须为 pending')
  }

  if (round.status === 'planned' && (round.reviewNote.trim() || round.keyTakeaways.length > 0)) {
    throw new OpportunityInputError('待进行的面试不能填写复盘内容，请先将面试标记为已完成')
  }

  if (round.status === 'completed' && round.result === 'pending') {
    throw new OpportunityInputError('已完成的面试结果不能为 pending')
  }

  if (round.status === 'canceled' && round.result !== 'unknown') {
    throw new OpportunityInputError('已取消的面试结果必须为 unknown')
  }
}

export type DuplicateJobOpportunityDetails = {
  existingOpportunity: Pick<JobOpportunity, 'id' | 'company' | 'jobTitle' | 'address'> & {
    analysisStatus: 'pending' | 'processing' | 'completed' | 'failed' | null
  }
}

export class DuplicateJobOpportunityError extends Error {
  statusCode = 409
  code = 'duplicate_opportunity'

  constructor(readonly details: DuplicateJobOpportunityDetails) {
    super('检测到历史已有相同 JD')
    this.name = 'DuplicateJobOpportunityError'
  }
}

export type JobOpportunityListItem = Pick<
  JobOpportunity,
  'id' | 'company' | 'jobTitle' | 'address' | 'status' | 'intentionLevel' | 'industry' | 'createdAt' | 'updatedAt'
> & {
  analysis: JobAnalysisListSummary | null
}

function toJobOpportunityListItem(
  opportunity: JobOpportunityRecord,
  analysis: JobAnalysisListSummary | null,
): JobOpportunityListItem {
  return {
    id: opportunity.id,
    company: opportunity.company,
    jobTitle: opportunity.jobTitle,
    address: opportunity.address,
    status: opportunity.status,
    intentionLevel: opportunity.intentionLevel,
    industry: opportunity.industry,
    createdAt: opportunity.createdAt,
    updatedAt: opportunity.updatedAt,
    analysis,
  }
}

function createStatusHistoryItem(
  opportunityId: string,
  toStatus: JobOpportunityStatus,
  fromStatus: JobOpportunityStatus | null,
  createdAt: string,
  note = '更新机会状态',
  trigger: OpportunityStatusChange['trigger'] = 'system',
): OpportunityStatusChange & { opportunityId: string } {
  return {
    id: crypto.randomUUID(),
    opportunityId,
    fromStatus,
    toStatus,
    trigger,
    note,
    createdAt,
  }
}

function isOpportunityProfilePatchApplied(opportunity: JobOpportunityRecord, patch: OpportunityProfilePatch) {
  if (patch.intentionLevel !== undefined && opportunity.intentionLevel !== patch.intentionLevel) return false
  if (patch.industry !== undefined && opportunity.industry !== patch.industry) return false
  if (patch.note !== undefined && opportunity.note !== patch.note) return false
  if (patch.includeWrittenTest !== undefined && opportunity.includeWrittenTest !== patch.includeWrittenTest)
    return false
  // “关闭笔试流程”在笔试中阶段还包含一次确定性的状态回退，不能只比较布尔开关。
  if (patch.includeWrittenTest === false && opportunity.status === 'written_test') return false
  if (
    patch.address !== undefined &&
    ((opportunity.address ?? []).length !== patch.address.length ||
      (opportunity.address ?? []).some((value, index) => value !== patch.address?.[index]))
  ) {
    return false
  }
  return true
}

export type UpdateOpportunityProfileForUserInput = {
  opportunityId: string
  userId: string
  expectedUpdatedAt: string
  patch: Pick<OpportunityProfilePatch, 'intentionLevel' | 'industry' | 'address' | 'note' | 'includeWrittenTest'>
}

export async function updateOpportunityProfileForUser(input: UpdateOpportunityProfileForUserInput) {
  const opportunity = await opportunityRepository.findOpportunityById(input.opportunityId)
  if (!opportunity || opportunity.userId !== input.userId) throw new OpportunityNotFoundError(input.opportunityId)
  if (opportunity.status === 'closed' && input.patch.includeWrittenTest !== undefined) {
    throw new OpportunityInputError('已终止的机会不能修改笔试流程')
  }
  if (isOpportunityProfilePatchApplied(opportunity, input.patch)) {
    return { opportunity, alreadyApplied: true }
  }

  const nextOpportunity = { ...opportunity, ...input.patch }
  const dedupeFingerprint = createOpportunityFingerprint(nextOpportunity)
  const exactDuplicate = await opportunityRepository.findOpportunityByDedupeFingerprint(input.userId, dedupeFingerprint)
  if (exactDuplicate && exactDuplicate.id !== opportunity.id) {
    throw await createDuplicateOpportunityError(exactDuplicate)
  }

  const updatedAt = new Date().toISOString()
  try {
    const updateRecord = {
      opportunityId: input.opportunityId,
      userId: input.userId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      patch: { ...input.patch, dedupeFingerprint },
      updatedAt,
    }
    const shouldRevertWrittenTestStatus =
      input.patch.includeWrittenTest === false && opportunity.status === 'written_test'
    const updated = shouldRevertWrittenTestStatus
      ? await opportunityRepository.updateOpportunityProfileWithStatusHistoryForUser({
          ...updateRecord,
          nextStatus: 'applied',
          statusHistory: createStatusHistoryItem(
            input.opportunityId,
            'applied',
            'written_test',
            updatedAt,
            '通过 AI 助手关闭笔试流程后回退到已投递',
            'user',
          ),
        })
      : await opportunityRepository.updateOpportunityProfileForUser(updateRecord)
    if (updated) return { opportunity: updated, alreadyApplied: false }
  } catch (error) {
    if (isUniqueViolation(error)) {
      const duplicate = await opportunityRepository.findOpportunityByDedupeFingerprint(input.userId, dedupeFingerprint)
      if (duplicate && duplicate.id !== opportunity.id) throw await createDuplicateOpportunityError(duplicate)
    }
    throw error
  }

  // 数据写入成功但 ToolAction 尚未完成时，Worker 重放会走到这里；目标值一致视为幂等成功。
  const current = await opportunityRepository.findOpportunityById(input.opportunityId)
  if (current?.userId === input.userId && isOpportunityProfilePatchApplied(current, input.patch)) {
    return { opportunity: current, alreadyApplied: true }
  }
  throw new OpportunityStatusConflictError()
}

export type BatchUpdateOpportunityProfilesForUserInput = {
  userId: string
  updates: Array<{
    opportunityId: string
    expectedUpdatedAt: string
    patch: UpdateOpportunityProfileForUserInput['patch']
  }>
}

/**
 * AI 批量修改工具的原子业务边界：先校验整批快照和去重约束，再在一个事务中全部写入。
 */
export async function batchUpdateOpportunityProfilesForUser(input: BatchUpdateOpportunityProfilesForUserInput) {
  if (input.updates.length < 2 || input.updates.length > 10) {
    throw new OpportunityInputError('批量修改一次需要包含 2 到 10 个机会')
  }

  const uniqueOpportunityIds = new Set(input.updates.map((update) => update.opportunityId))
  if (uniqueOpportunityIds.size !== input.updates.length) {
    throw new OpportunityInputError('同一个机会不能在一次批量修改中重复出现')
  }
  if (input.updates.some((update) => !Object.values(update.patch).some((value) => value !== undefined))) {
    throw new OpportunityInputError('批量修改中的每个机会都至少需要一个修改字段')
  }

  const userOpportunities = await opportunityRepository.findOpportunitiesByUserId(input.userId)
  const opportunitiesById = new Map(userOpportunities.map((opportunity) => [opportunity.id, opportunity]))
  const targets = input.updates.map((update) => {
    const opportunity = opportunitiesById.get(update.opportunityId)
    if (!opportunity) throw new OpportunityNotFoundError(update.opportunityId)
    if (opportunity.status === 'closed' && update.patch.includeWrittenTest !== undefined) {
      throw new OpportunityInputError('已终止的机会不能修改笔试流程')
    }
    return { update, opportunity, alreadyApplied: isOpportunityProfilePatchApplied(opportunity, update.patch) }
  })

  if (targets.every((target) => target.alreadyApplied)) {
    return { opportunities: targets.map((target) => target.opportunity), alreadyApplied: true }
  }
  if (targets.some((target) => target.alreadyApplied)) throw new OpportunityStatusConflictError()
  if (targets.some((target) => target.opportunity.updatedAt !== target.update.expectedUpdatedAt)) {
    throw new OpportunityStatusConflictError()
  }

  const nextOpportunities = new Map(userOpportunities.map((opportunity) => [opportunity.id, opportunity]))
  for (const target of targets) {
    nextOpportunities.set(target.opportunity.id, {
      ...target.opportunity,
      ...target.update.patch,
      ...(target.update.patch.includeWrittenTest === false && target.opportunity.status === 'written_test'
        ? { status: 'applied' as const }
        : {}),
    })
  }

  const fingerprintOwners = new Map<string, JobOpportunityRecord>()
  for (const opportunity of nextOpportunities.values()) {
    const fingerprint = createOpportunityFingerprint(opportunity)
    const duplicate = fingerprintOwners.get(fingerprint)
    if (duplicate && duplicate.id !== opportunity.id) throw await createDuplicateOpportunityError(duplicate)
    fingerprintOwners.set(fingerprint, opportunity)
  }

  const updatedAt = new Date().toISOString()
  const records = targets.map(({ opportunity, update }) => {
    const nextOpportunity = nextOpportunities.get(opportunity.id)!
    const patch = { ...update.patch, dedupeFingerprint: createOpportunityFingerprint(nextOpportunity) }
    const shouldRevertWrittenTestStatus =
      update.patch.includeWrittenTest === false && opportunity.status === 'written_test'
    return shouldRevertWrittenTestStatus
      ? {
          opportunityId: opportunity.id,
          userId: input.userId,
          expectedUpdatedAt: update.expectedUpdatedAt,
          patch,
          updatedAt,
          nextStatus: 'applied' as const,
          statusHistory: createStatusHistoryItem(
            opportunity.id,
            'applied',
            'written_test',
            updatedAt,
            '通过 AI 助手批量关闭笔试流程后回退到已投递',
            'user',
          ),
        }
      : {
          opportunityId: opportunity.id,
          userId: input.userId,
          expectedUpdatedAt: update.expectedUpdatedAt,
          patch,
          updatedAt,
        }
  })

  try {
    const opportunities = await opportunityRepository.batchUpdateOpportunityProfilesForUser(records)
    return { opportunities, alreadyApplied: false }
  } catch (error) {
    if (error instanceof OpportunityRepositoryConflictError) throw new OpportunityStatusConflictError()
    if (isUniqueViolation(error)) {
      for (const record of records) {
        const duplicate = await opportunityRepository.findOpportunityByDedupeFingerprint(
          input.userId,
          record.patch.dedupeFingerprint!,
        )
        if (duplicate && duplicate.id !== record.opportunityId) throw await createDuplicateOpportunityError(duplicate)
      }
    }
    throw error
  }
}

export type CreateInterviewScheduleForUserInput = {
  roundId: string
  opportunityId: string
  userId: string
  type: InterviewRound['type']
  title: string
  scheduledAt: string
  note: string
}

export type UpdateWrittenTestReviewForUserInput = {
  opportunityId: string
  userId: string
  expectedUpdatedAt: string
  scheduledAt: string | null
  reviewNote: string
  modelConnection?: ModelConnection
}

export type UpdateInterviewReviewForUserInput = {
  opportunityId: string
  roundId: string
  userId: string
  expectedRoundUpdatedAt: string
  scheduledAt: string | null
  result: Exclude<InterviewRound['result'], 'pending'>
  reviewNote: string
  modelConnection?: ModelConnection
}

function isSameWrittenTestReview(opportunity: JobOpportunityRecord, input: UpdateWrittenTestReviewForUserInput) {
  return (
    opportunity.writtenTestScheduledAt === input.scheduledAt &&
    (opportunity.writtenTestReviewNote ?? '') === input.reviewNote
  )
}

/**
 * AI 工具专用的显式用户版本：确认时使用机会版本做并发保护，重复执行相同目标时按幂等成功处理。
 */
export async function updateWrittenTestReviewForUser(input: UpdateWrittenTestReviewForUserInput) {
  const opportunity = await opportunityRepository.findOpportunityById(input.opportunityId)
  if (!opportunity || opportunity.userId !== input.userId) throw new OpportunityNotFoundError(input.opportunityId)
  if (!opportunity.includeWrittenTest) throw new OpportunityInputError('当前机会未开启笔试流程')
  if (!input.reviewNote.trim()) throw new OpportunityInputError('笔试复盘内容不能为空')

  if (isSameWrittenTestReview(opportunity, input)) {
    await syncReviewDocument({
      opportunityId: input.opportunityId,
      sourceType: 'written_test',
      rawText: input.reviewNote,
      modelConnection: input.modelConnection,
    })
    return { opportunity, alreadyApplied: true }
  }
  if (opportunity.updatedAt !== input.expectedUpdatedAt) throw new OpportunityStatusConflictError()

  const updatedAt = new Date().toISOString()
  const updated = await opportunityRepository.updateWrittenTestReviewForUser({
    opportunityId: input.opportunityId,
    userId: input.userId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    scheduledAt: input.scheduledAt,
    reviewNote: input.reviewNote,
    updatedAt,
  })

  if (updated) {
    await syncReviewDocument({
      opportunityId: input.opportunityId,
      sourceType: 'written_test',
      rawText: updated.writtenTestReviewNote ?? '',
      modelConnection: input.modelConnection,
    })
    return { opportunity: updated, alreadyApplied: false }
  }

  const current = await opportunityRepository.findOpportunityById(input.opportunityId)
  if (current?.userId === input.userId && isSameWrittenTestReview(current, input)) {
    await syncReviewDocument({
      opportunityId: input.opportunityId,
      sourceType: 'written_test',
      rawText: current.writtenTestReviewNote ?? '',
      modelConnection: input.modelConnection,
    })
    return { opportunity: current, alreadyApplied: true }
  }
  throw new OpportunityStatusConflictError()
}

function isSameInterviewReview(round: InterviewRound, input: UpdateInterviewReviewForUserInput) {
  return (
    round.status === 'completed' &&
    round.result === input.result &&
    (round.scheduledAt || null) === input.scheduledAt &&
    round.reviewNote === input.reviewNote
  )
}

/**
 * AI 工具专用的真实面试复盘写入：既能更新已完成轮次，也能把已经发生的安排原子地转成已完成。
 */
export async function updateInterviewReviewForUser(input: UpdateInterviewReviewForUserInput) {
  const [opportunity, round] = await Promise.all([
    opportunityRepository.findOpportunityById(input.opportunityId),
    opportunityRepository.findInterviewRoundById(input.opportunityId, input.roundId),
  ])
  if (!opportunity || opportunity.userId !== input.userId || !round) {
    throw new OpportunityNotFoundError(input.opportunityId)
  }
  if (round.status === 'canceled') throw new OpportunityInterviewRoundConflictError('已取消的面试不能保存复盘')
  if (!input.reviewNote.trim()) throw new OpportunityInputError('面试复盘内容不能为空')

  if (input.scheduledAt) {
    const occurredAt = new Date(input.scheduledAt)
    if (Number.isNaN(occurredAt.getTime()) || occurredAt.getTime() > Date.now()) {
      throw new OpportunityInputError('面试复盘时间不能晚于当前时间')
    }
  }

  if (isSameInterviewReview(round, input)) {
    await syncReviewDocument({
      opportunityId: input.opportunityId,
      sourceType: 'interview',
      interviewRoundId: input.roundId,
      rawText: input.reviewNote,
      modelConnection: input.modelConnection,
    })
    return { round, alreadyApplied: true }
  }
  if (round.updatedAt !== input.expectedRoundUpdatedAt) throw new OpportunityInterviewRoundConflictError()

  const updated = await opportunityRepository.updateInterviewReviewForUser({
    opportunityId: input.opportunityId,
    roundId: input.roundId,
    userId: input.userId,
    expectedRoundUpdatedAt: input.expectedRoundUpdatedAt,
    scheduledAt: input.scheduledAt,
    result: input.result,
    reviewNote: input.reviewNote,
    updatedAt: new Date().toISOString(),
  })

  if (updated) {
    await syncReviewDocument({
      opportunityId: input.opportunityId,
      sourceType: 'interview',
      interviewRoundId: input.roundId,
      rawText: updated.reviewNote,
      modelConnection: input.modelConnection,
    })
    return { round: updated, alreadyApplied: false }
  }

  const current = await opportunityRepository.findInterviewRoundById(input.opportunityId, input.roundId)
  if (current && isSameInterviewReview(current, input)) {
    await syncReviewDocument({
      opportunityId: input.opportunityId,
      sourceType: 'interview',
      interviewRoundId: input.roundId,
      rawText: current.reviewNote,
      modelConnection: input.modelConnection,
    })
    return { round: current, alreadyApplied: true }
  }
  throw new OpportunityInterviewRoundConflictError()
}

function isSameInterviewSchedule(round: InterviewRound, input: CreateInterviewScheduleForUserInput) {
  const normalizedScheduledAt = new Date(input.scheduledAt).toISOString()
  return (
    round.type === input.type &&
    round.title === input.title &&
    round.scheduledAt === normalizedScheduledAt &&
    round.note === input.note &&
    round.status === 'planned'
  )
}

/**
 * AI 工具专用的显式用户版本：不依赖请求上下文，并用 roundId 保证 Worker 重放幂等。
 */
export async function createInterviewScheduleForUser(input: CreateInterviewScheduleForUserInput) {
  const existingRound = await opportunityRepository.findInterviewRoundById(input.opportunityId, input.roundId)
  if (existingRound) {
    if (!isSameInterviewSchedule(existingRound, input)) {
      throw new OpportunityInterviewRoundConflictError('面试安排幂等键已被其他内容占用')
    }
    return { round: existingRound, alreadyApplied: true }
  }

  const opportunity = await opportunityRepository.findOpportunityById(input.opportunityId)
  if (!opportunity || opportunity.userId !== input.userId) throw new OpportunityNotFoundError(input.opportunityId)
  if (opportunity.status !== 'interviewing') {
    throw new OpportunityInterviewRoundConflictError('只有面试中阶段可以创建面试安排')
  }

  const scheduledAt = new Date(input.scheduledAt)
  if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
    throw new OpportunityInputError('面试安排时间必须晚于当前时间')
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const sequence = await opportunityRepository.findNextInterviewRoundSequence(input.opportunityId)
    const now = new Date().toISOString()
    const round: InterviewRound & { opportunityId: string } = {
      id: input.roundId,
      opportunityId: input.opportunityId,
      type: input.type,
      sequence,
      title: input.title,
      scheduledAt: scheduledAt.toISOString(),
      status: 'planned',
      result: 'pending',
      note: input.note,
      reviewNote: '',
      keyTakeaways: [],
      createdAt: now,
      updatedAt: now,
    }
    assertInterviewRoundState(round)

    try {
      await opportunityRepository.createInterviewRound(round, { ...opportunity, updatedAt: now })
      return { round, alreadyApplied: false }
    } catch (error) {
      const replayedRound = await opportunityRepository.findInterviewRoundById(input.opportunityId, input.roundId)
      if (replayedRound && isSameInterviewSchedule(replayedRound, input)) {
        return { round: replayedRound, alreadyApplied: true }
      }
      // 同一机会并发新增时 sequence 可能冲突；重新读取序号后再试，不吞掉其他唯一约束错误。
      if (!isUniqueViolation(error) || attempt === 2) throw error
    }
  }

  throw new OpportunityInterviewRoundConflictError('创建面试安排失败，请重试')
}

export type TransitionOpportunityStatusForUserInput = {
  opportunityId: string
  userId: string
  expectedStatus: Exclude<JobOpportunityStatus, 'closed'>
  nextStatus: Exclude<JobOpportunityStatus, 'closed'>
  enableWrittenTest?: boolean
  note?: string
}

export async function transitionOpportunityStatusForUser(input: TransitionOpportunityStatusForUserInput) {
  const opportunity = await opportunityRepository.findOpportunityById(input.opportunityId)
  if (!opportunity || opportunity.userId !== input.userId) throw new OpportunityNotFoundError(input.opportunityId)
  if (opportunity.status === 'closed') throw new OpportunityInputError('A closed opportunity cannot change status')

  if (opportunity.status !== input.expectedStatus) {
    if (opportunity.status === input.nextStatus) return { opportunity, alreadyApplied: true }
    throw new OpportunityStatusConflictError()
  }

  const includeWrittenTest = opportunity.includeWrittenTest || input.enableWrittenTest === true
  if (input.nextStatus === 'written_test' && !includeWrittenTest) {
    throw new OpportunityInputError('进入笔试中前必须先开启笔试流程')
  }
  if (!isAllowedStatusTransition(opportunity.status, input.nextStatus, includeWrittenTest)) {
    throw new OpportunityInputError('Status transition is not allowed')
  }
  if (opportunity.status === input.nextStatus) return { opportunity, alreadyApplied: true }

  const now = new Date().toISOString()
  const updatedOpportunity: JobOpportunityRecord = {
    ...opportunity,
    status: input.nextStatus,
    includeWrittenTest,
    updatedAt: now,
  }
  const statusHistory = createStatusHistoryItem(
    input.opportunityId,
    input.nextStatus,
    opportunity.status,
    now,
    input.note ?? '用户通过 AI 助手流转机会状态',
    'user',
  )
  const isUpdated = await opportunityRepository.updateOpportunityWithStatusHistoryIfCurrentStatus(
    updatedOpportunity,
    input.expectedStatus,
    statusHistory,
  )
  if (!isUpdated) {
    const current = await opportunityRepository.findOpportunityById(input.opportunityId)
    if (current?.userId === input.userId && current.status === input.nextStatus) {
      return { opportunity: current, alreadyApplied: true }
    }
    throw new OpportunityStatusConflictError()
  }

  return { opportunity: updatedOpportunity, alreadyApplied: false }
}

async function getOpportunityForCurrentUser(opportunityId: string): Promise<JobOpportunityRecord> {
  const [userId, opportunity] = await Promise.all([
    getCurrentUserId(),
    opportunityRepository.findOpportunityById(opportunityId),
  ])

  if (!opportunity || opportunity.userId !== userId) {
    throw new OpportunityNotFoundError(opportunityId)
  }

  return opportunity
}

async function getOpportunityDetailOrThrow(opportunityId: string): Promise<JobOpportunityDetail> {
  const detail = await opportunityRepository.findOpportunityDetailById(opportunityId)
  if (!detail) throw new OpportunityNotFoundError(opportunityId)

  return detail
}

async function findExactDuplicateOpportunity(userId: string, dedupeFingerprint: string) {
  const indexedOpportunity = await opportunityRepository.findOpportunityByDedupeFingerprint(userId, dedupeFingerprint)
  if (indexedOpportunity) return indexedOpportunity

  // dedupe_fingerprint 是新增字段；兼容上线前已存在的历史记录。
  const legacyOpportunities = await opportunityRepository.findOpportunitiesByUserId(userId)
  return legacyOpportunities.find((opportunity) => {
    return createOpportunityFingerprint(opportunity) === dedupeFingerprint
  })
}

async function createDuplicateOpportunityError(existingOpportunity: JobOpportunityRecord) {
  const analysis = await jobAnalysisRepository.findAnalysisByOpportunityId(existingOpportunity.id)

  return new DuplicateJobOpportunityError({
    existingOpportunity: {
      id: existingOpportunity.id,
      company: existingOpportunity.company,
      jobTitle: existingOpportunity.jobTitle,
      address: existingOpportunity.address,
      analysisStatus: analysis?.status ?? null,
    },
  })
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === '23505'
  )
}

export async function createJobOpportunity(input: unknown): Promise<JobOpportunityDetail> {
  const parsedInput = createJobOpportunityInputSchema.parse(input)
  const userId = await getCurrentUserId()
  const now = new Date().toISOString()
  const opportunityId = crypto.randomUUID()
  const dedupeFingerprint = createOpportunityFingerprint(parsedInput)
  const exactDuplicate = await findExactDuplicateOpportunity(userId, dedupeFingerprint)

  if (exactDuplicate) throw await createDuplicateOpportunityError(exactDuplicate)

  const opportunity: JobOpportunityRecord = {
    id: opportunityId,
    userId,
    company: parsedInput.company,
    jobTitle: parsedInput.jobTitle,
    dedupeFingerprint,
    address: parsedInput.address,
    introduction: parsedInput.introduction,
    description: parsedInput.description,
    status: 'pending_apply',
    includeWrittenTest: false,
    intentionLevel: 'B',
    industry: '',
    note: '',
    writtenTestScheduledAt: null,
    writtenTestReviewNote: null,
    writtenTestReviewedAt: null,
    createdAt: now,
    updatedAt: now,
  }

  const initialStatusHistory = createStatusHistoryItem(opportunityId, 'pending_apply', null, now, '创建机会')

  try {
    await opportunityRepository.createOpportunityWithInitialStatus({
      opportunity,
      initialStatusHistory,
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      const duplicate = await opportunityRepository.findOpportunityByDedupeFingerprint(userId, dedupeFingerprint)
      if (duplicate) throw await createDuplicateOpportunityError(duplicate)
    }

    throw error
  }

  const detail = await opportunityRepository.findOpportunityDetailById(opportunityId)
  if (!detail) throw new OpportunityNotFoundError(opportunityId)

  return detail
}

export async function getJobOpportunities(filters: JobOpportunityListFilters): Promise<JobOpportunityListItem[]> {
  const userId = await getCurrentUserId()
  const opportunities = await opportunityRepository.findOpportunitiesByUserId(userId)
  const opportunityIds = opportunities.map((opportunity) => opportunity.id)
  const analysisSummaries = await getJobAnalysisListSummaries(opportunityIds)

  return opportunities
    .map((opportunity) => toJobOpportunityListItem(opportunity, analysisSummaries.get(opportunity.id) ?? null))
    .filter((opportunity) => {
      if (filters.statuses.length > 0 && !filters.statuses.includes(opportunity.status)) return false
      if (filters.intentionLevels.length > 0 && !filters.intentionLevels.includes(opportunity.intentionLevel))
        return false
      if (
        filters.recommendations.length > 0 &&
        (!opportunity.analysis?.recommendation ||
          !filters.recommendations.includes(opportunity.analysis.recommendation))
      ) {
        return false
      }

      if (
        filters.regions.length > 0 &&
        !getOpportunityRegions(opportunity.address).some((region) => filters.regions.includes(region))
      ) {
        return false
      }

      return true
    })
}

export async function getJobOpportunityById(opportunityId: string) {
  await getOpportunityForCurrentUser(opportunityId)

  return getOpportunityDetailOrThrow(opportunityId)
}

export async function deleteJobOpportunity(opportunityId: string): Promise<{ id: string }> {
  const userId = await getCurrentUserId()
  await getOpportunityForCurrentUser(opportunityId)
  if (await interviewRepository.hasSessionsByOpportunityId(opportunityId)) {
    throw new OpportunityInterviewHistoryConflictError()
  }
  const analysis = await jobAnalysisRepository.findAnalysisByOpportunityId(opportunityId)
  cancelJobAnalysisForOpportunity(opportunityId)
  if (analysis && !analysis.sourceAnalysisId && (analysis.status === 'pending' || analysis.status === 'processing')) {
    await jobAnalysisRepository.markFollowersFailedForDeletedSource(analysis.id, new Date().toISOString())
  }
  const deletedOpportunityId = await opportunityRepository.deleteOpportunityForUser(opportunityId, userId)

  if (!deletedOpportunityId) throw new OpportunityNotFoundError(opportunityId)

  return { id: deletedOpportunityId }
}

export async function updateJobOpportunity(opportunityId: string, input: unknown): Promise<JobOpportunityDetail> {
  const opportunity = await getOpportunityForCurrentUser(opportunityId)
  const parsedInput = updateJobOpportunityInputSchema.parse(input)
  const now = new Date().toISOString()

  const updatedOpportunity: JobOpportunityRecord = {
    ...opportunity,
    company: parsedInput.company ?? opportunity.company,
    jobTitle: parsedInput.jobTitle ?? opportunity.jobTitle,
    address: parsedInput.address ?? opportunity.address,
    introduction: parsedInput.introduction ?? opportunity.introduction,
    description: parsedInput.description ?? opportunity.description,
    includeWrittenTest: parsedInput.includeWrittenTest ?? opportunity.includeWrittenTest,
    intentionLevel: parsedInput.intentionLevel ?? opportunity.intentionLevel,
    industry: parsedInput.industry ?? opportunity.industry,
    note: parsedInput.note ?? opportunity.note,
    updatedAt: now,
  }
  updatedOpportunity.dedupeFingerprint = createOpportunityFingerprint(updatedOpportunity)

  const exactDuplicate = await opportunityRepository.findOpportunityByDedupeFingerprint(
    opportunity.userId,
    updatedOpportunity.dedupeFingerprint,
  )
  if (exactDuplicate && exactDuplicate.id !== opportunity.id) {
    throw await createDuplicateOpportunityError(exactDuplicate)
  }

  const shouldRevertWrittenTestStatus =
    parsedInput.includeWrittenTest === false && opportunity.includeWrittenTest && opportunity.status === 'written_test'

  if (shouldRevertWrittenTestStatus) {
    updatedOpportunity.status = 'applied'
    const statusHistory = createStatusHistoryItem(
      opportunityId,
      'applied',
      'written_test',
      now,
      '关闭笔试流程后回退到已投递',
    )
    await opportunityRepository.updateOpportunityWithStatusHistory(updatedOpportunity, statusHistory)
  } else {
    await opportunityRepository.updateOpportunity(updatedOpportunity)
  }

  return getOpportunityDetailOrThrow(opportunityId)
}

export async function updateJobOpportunityStatus(opportunityId: string, input: unknown): Promise<JobOpportunityDetail> {
  const parsedInput = updateJobOpportunityStatusInputSchema.parse(input)

  if (parsedInput.status === 'closed') {
    throw new OpportunityInputError('Use the termination endpoint to close an opportunity')
  }

  await transitionOpportunityStatusForUser({
    opportunityId,
    userId: await getCurrentUserId(),
    expectedStatus: parsedInput.expectedStatus,
    nextStatus: parsedInput.status,
    note: parsedInput.note,
  })

  return getOpportunityDetailOrThrow(opportunityId)
}

export async function updateWrittenTestReview(opportunityId: string, input: unknown): Promise<WrittenTestReview> {
  const opportunity = await getOpportunityForCurrentUser(opportunityId)
  const parsedInput = updateWrittenTestReviewInputSchema.parse(input)
  const now = new Date().toISOString()

  const updatedOpportunity: JobOpportunityRecord = {
    ...opportunity,
    writtenTestScheduledAt: parsedInput.scheduledAt ?? opportunity.writtenTestScheduledAt,
    writtenTestReviewNote: parsedInput.reviewNote ?? opportunity.writtenTestReviewNote,
    writtenTestReviewedAt: now,
    updatedAt: now,
  }

  await opportunityRepository.updateOpportunity(updatedOpportunity)

  if (parsedInput.reviewNote !== undefined) {
    await syncReviewDocument({
      opportunityId,
      sourceType: 'written_test',
      rawText: updatedOpportunity.writtenTestReviewNote ?? '',
      modelConnection: parsedInput.modelConnection,
    })
  }

  return {
    scheduledAt: updatedOpportunity.writtenTestScheduledAt ?? '',
    reviewNote: updatedOpportunity.writtenTestReviewNote ?? '',
    updatedAt: updatedOpportunity.writtenTestReviewedAt ?? updatedOpportunity.updatedAt,
  }
}

export async function addInterviewRound(opportunityId: string, input: unknown): Promise<InterviewRound> {
  const opportunity = await getOpportunityForCurrentUser(opportunityId)
  const parsedInput = addInterviewRoundInputSchema.parse(input)
  const now = new Date().toISOString()
  const sequence = await opportunityRepository.findNextInterviewRoundSequence(opportunityId)
  // 兼容旧前端：携带复盘正文但没有显式状态时，按已完成轮次处理。
  const status = parsedInput.status ?? (parsedInput.reviewNote?.trim() ? 'completed' : 'planned')
  const result = parsedInput.result ?? (status === 'planned' ? 'pending' : 'unknown')
  const round: InterviewRound & { opportunityId: string } = {
    id: crypto.randomUUID(),
    opportunityId,
    type: parsedInput.type,
    sequence,
    title: parsedInput.title || `第 ${sequence} 轮`,
    scheduledAt: parsedInput.scheduledAt ?? '',
    status,
    result,
    note: parsedInput.note ?? '',
    reviewNote: parsedInput.reviewNote ?? '',
    keyTakeaways: parsedInput.keyTakeaways ?? [],
    createdAt: now,
    updatedAt: now,
  }
  assertInterviewRoundState(round)
  const updatedOpportunity = {
    ...opportunity,
    updatedAt: now,
  }

  await opportunityRepository.createInterviewRound(round, updatedOpportunity)

  if (round.status === 'completed' && parsedInput.reviewNote !== undefined) {
    await syncReviewDocument({
      opportunityId,
      sourceType: 'interview',
      interviewRoundId: round.id,
      rawText: round.reviewNote,
      modelConnection: parsedInput.modelConnection,
    })
  }

  return round
}

export async function updateInterviewRound(
  opportunityId: string,
  roundId: string,
  input: unknown,
): Promise<InterviewRound> {
  const [opportunity, existingRound] = await Promise.all([
    getOpportunityForCurrentUser(opportunityId),
    opportunityRepository.findInterviewRoundById(opportunityId, roundId),
  ])
  if (!existingRound) throw new OpportunityNotFoundError(opportunityId)

  const parsedInput = updateInterviewRoundInputSchema.parse(input)
  const now = new Date().toISOString()
  const updatedRound: InterviewRound & { opportunityId: string } = {
    ...existingRound,
    opportunityId,
    type: parsedInput.type ?? existingRound.type,
    title: parsedInput.title ?? existingRound.title,
    scheduledAt: parsedInput.scheduledAt ?? existingRound.scheduledAt,
    status: existingRound.status,
    result: parsedInput.result ?? existingRound.result,
    note: parsedInput.note ?? existingRound.note,
    reviewNote: parsedInput.reviewNote ?? existingRound.reviewNote,
    keyTakeaways: parsedInput.keyTakeaways ?? existingRound.keyTakeaways,
    updatedAt: now,
  }
  assertInterviewRoundState(updatedRound)
  const updatedOpportunity = {
    ...opportunity,
    updatedAt: now,
  }

  await opportunityRepository.updateInterviewRound(updatedRound, updatedOpportunity)

  if (updatedRound.status === 'completed' && parsedInput.reviewNote !== undefined) {
    await syncReviewDocument({
      opportunityId,
      sourceType: 'interview',
      interviewRoundId: updatedRound.id,
      rawText: updatedRound.reviewNote,
      modelConnection: parsedInput.modelConnection,
    })
  }

  return updatedRound
}

export async function completeInterviewRound(
  opportunityId: string,
  roundId: string,
  input: unknown,
): Promise<InterviewRound> {
  const [opportunity, existingRound] = await Promise.all([
    getOpportunityForCurrentUser(opportunityId),
    opportunityRepository.findInterviewRoundById(opportunityId, roundId),
  ])
  if (!existingRound) throw new OpportunityNotFoundError(opportunityId)

  const parsedInput = completeInterviewRoundInputSchema.parse(input)
  if (existingRound.status === 'completed') return existingRound
  if (existingRound.status !== 'planned') {
    throw new OpportunityInterviewRoundConflictError('只有待进行的面试可以标记为已完成')
  }

  const now = new Date().toISOString()
  const updatedRound: InterviewRound & { opportunityId: string } = {
    ...existingRound,
    opportunityId,
    status: 'completed',
    result: parsedInput.result ?? 'unknown',
    updatedAt: now,
  }
  const updatedOpportunity = { ...opportunity, updatedAt: now }
  const isUpdated = await opportunityRepository.updateInterviewRoundIfCurrentStatus(
    updatedRound,
    'planned',
    updatedOpportunity,
  )

  if (!isUpdated) {
    const currentRound = await opportunityRepository.findInterviewRoundById(opportunityId, roundId)
    if (currentRound?.status === 'completed') return currentRound
    throw new OpportunityInterviewRoundConflictError()
  }

  return updatedRound
}

export async function cancelInterviewRound(
  opportunityId: string,
  roundId: string,
  input: unknown,
): Promise<InterviewRound> {
  const [opportunity, existingRound] = await Promise.all([
    getOpportunityForCurrentUser(opportunityId),
    opportunityRepository.findInterviewRoundById(opportunityId, roundId),
  ])
  if (!existingRound) throw new OpportunityNotFoundError(opportunityId)

  cancelInterviewRoundInputSchema.parse(input)
  if (existingRound.status === 'canceled') return existingRound
  if (existingRound.status !== 'planned') {
    throw new OpportunityInterviewRoundConflictError('只有待进行的面试可以取消')
  }

  const now = new Date().toISOString()
  const updatedRound: InterviewRound & { opportunityId: string } = {
    ...existingRound,
    opportunityId,
    status: 'canceled',
    result: 'unknown',
    updatedAt: now,
  }
  const updatedOpportunity = { ...opportunity, updatedAt: now }
  const isUpdated = await opportunityRepository.updateInterviewRoundIfCurrentStatus(
    updatedRound,
    'planned',
    updatedOpportunity,
  )

  if (!isUpdated) {
    const currentRound = await opportunityRepository.findInterviewRoundById(opportunityId, roundId)
    if (currentRound?.status === 'canceled') return currentRound
    throw new OpportunityInterviewRoundConflictError()
  }

  return updatedRound
}

export async function deleteInterviewRound(opportunityId: string, roundId: string): Promise<{ id: string }> {
  const [opportunity, existingRound] = await Promise.all([
    getOpportunityForCurrentUser(opportunityId),
    opportunityRepository.findInterviewRoundById(opportunityId, roundId),
  ])
  if (!existingRound) throw new OpportunityNotFoundError(opportunityId)

  await opportunityRepository.deleteInterviewRound(opportunityId, roundId, {
    ...opportunity,
    updatedAt: new Date().toISOString(),
  })

  return { id: roundId }
}

export async function terminateJobOpportunity(opportunityId: string, input: unknown): Promise<JobOpportunityDetail> {
  const opportunity = await getOpportunityForCurrentUser(opportunityId)
  const parsedInput = terminateOpportunityInputSchema.parse(input)

  if (opportunity.status === 'closed') return getOpportunityDetailOrThrow(opportunityId)

  const relatedRound = parsedInput.relatedInterviewRoundId
    ? await opportunityRepository.findInterviewRoundById(opportunityId, parsedInput.relatedInterviewRoundId)
    : null

  if (parsedInput.relatedInterviewRoundId && !relatedRound) {
    throw new OpportunityNotFoundError(opportunityId)
  }

  const now = new Date().toISOString()
  const updatedOpportunity: JobOpportunityRecord = {
    ...opportunity,
    status: 'closed',
    updatedAt: now,
  }
  const statusHistory = createStatusHistoryItem(opportunityId, 'closed', opportunity.status, now, '流程终止')
  const termination: OpportunityTermination = {
    id: crypto.randomUUID(),
    opportunityId,
    fromStatus: opportunity.status,
    relatedInterviewRoundId: relatedRound?.id,
    relatedInterviewRoundTitle: relatedRound?.title,
    reasonCode: parsedInput.reasonCode ?? 'other',
    reasonNote: parsedInput.reasonNote ?? '',
    createdAt: now,
  }

  await opportunityRepository.terminateOpportunity(updatedOpportunity, statusHistory, termination)

  return getOpportunityDetailOrThrow(opportunityId)
}
