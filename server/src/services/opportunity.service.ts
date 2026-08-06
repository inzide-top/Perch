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
  type JobOpportunityDetail,
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
): OpportunityStatusChange & { opportunityId: string } {
  return {
    id: crypto.randomUUID(),
    opportunityId,
    fromStatus,
    toStatus,
    trigger: 'system',
    note,
    createdAt,
  }
}

function getStatusFlow(includeWrittenTest: boolean): Exclude<JobOpportunityStatus, 'closed'>[] {
  return includeWrittenTest
    ? ['pending_apply', 'applied', 'written_test', 'interviewing', 'oc', 'offered']
    : ['pending_apply', 'applied', 'interviewing', 'oc', 'offered']
}

function isAllowedStatusTransition(
  fromStatus: Exclude<JobOpportunityStatus, 'closed'>,
  toStatus: Exclude<JobOpportunityStatus, 'closed'>,
  includeWrittenTest: boolean,
) {
  if (fromStatus === toStatus) return true
  const flow = getStatusFlow(includeWrittenTest)
  const fromIndex = flow.indexOf(fromStatus)
  const toIndex = flow.indexOf(toStatus)

  return fromIndex >= 0 && toIndex >= 0 && Math.abs(fromIndex - toIndex) === 1
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
  const opportunity = await getOpportunityForCurrentUser(opportunityId)
  const parsedInput = updateJobOpportunityStatusInputSchema.parse(input)

  if (parsedInput.status === 'closed') {
    throw new OpportunityInputError('Use the termination endpoint to close an opportunity')
  }

  if (opportunity.status === 'closed') {
    throw new OpportunityInputError('A closed opportunity cannot change status')
  }

  if (opportunity.status !== parsedInput.expectedStatus) {
    throw new OpportunityStatusConflictError()
  }

  if (!isAllowedStatusTransition(opportunity.status, parsedInput.status, opportunity.includeWrittenTest)) {
    throw new OpportunityInputError('Status transition is not allowed')
  }

  if (opportunity.status === parsedInput.status) return getOpportunityDetailOrThrow(opportunityId)

  const now = new Date().toISOString()
  const updatedOpportunity: JobOpportunityRecord = {
    ...opportunity,
    status: parsedInput.status,
    updatedAt: now,
  }
  const statusHistory = createStatusHistoryItem(
    opportunityId,
    parsedInput.status,
    opportunity.status,
    now,
    parsedInput.note ?? '用户流转机会状态',
  )

  const isUpdated = await opportunityRepository.updateOpportunityWithStatusHistoryIfCurrentStatus(
    updatedOpportunity,
    parsedInput.expectedStatus,
    statusHistory,
  )

  if (!isUpdated) throw new OpportunityStatusConflictError()

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
