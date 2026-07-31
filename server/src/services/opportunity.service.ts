import type {
  InterviewRound,
  JobOpportunity,
  JobOpportunityStatus,
  OpportunityStatusChange,
  OpportunityTermination,
  WrittenTestReview,
} from '@/types/opportunity'
import {
  opportunityRepository,
  type JobOpportunityDetail,
  type JobOpportunityRecord,
} from '../repositories/opportunity.repository'
import {
  addInterviewRoundInputSchema,
  createJobOpportunityInputSchema,
  terminateOpportunityInputSchema,
  updateInterviewRoundInputSchema,
  updateJobOpportunityInputSchema,
  updateJobOpportunityStatusInputSchema,
  updateWrittenTestReviewInputSchema,
} from '../schemas/opportunity.schema'
import { getCurrentUserId } from './resume.service'

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

export type JobOpportunityListItem = Pick<
  JobOpportunity,
  'id' | 'company' | 'jobTitle' | 'address' | 'status' | 'intentionLevel' | 'industry' | 'createdAt' | 'updatedAt'
>

function toJobOpportunityListItem(opportunity: JobOpportunityRecord): JobOpportunityListItem {
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

export async function createJobOpportunity(input: unknown): Promise<JobOpportunityDetail> {
  const parsedInput = createJobOpportunityInputSchema.parse(input)
  const userId = await getCurrentUserId()
  const now = new Date().toISOString()
  const opportunityId = crypto.randomUUID()

  const opportunity: JobOpportunityRecord = {
    id: opportunityId,
    userId,
    company: parsedInput.company,
    jobTitle: parsedInput.jobTitle,
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

  await opportunityRepository.createOpportunityWithInitialStatus({
    opportunity,
    initialStatusHistory,
  })

  const detail = await opportunityRepository.findOpportunityDetailById(opportunityId)
  if (!detail) throw new OpportunityNotFoundError(opportunityId)

  return detail
}

export async function getJobOpportunities(): Promise<JobOpportunityListItem[]> {
  const userId = await getCurrentUserId()
  const opportunities = await opportunityRepository.findOpportunitiesByUserId(userId)

  return opportunities.map(toJobOpportunityListItem)
}

export async function getJobOpportunityById(opportunityId: string) {
  await getOpportunityForCurrentUser(opportunityId)

  return getOpportunityDetailOrThrow(opportunityId)
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
  const round: InterviewRound & { opportunityId: string } = {
    id: crypto.randomUUID(),
    opportunityId,
    type: parsedInput.type,
    sequence,
    title: parsedInput.title || `第 ${sequence} 轮`,
    scheduledAt: parsedInput.scheduledAt ?? '',
    status: parsedInput.status ?? 'planned',
    result: parsedInput.result ?? 'pending',
    note: parsedInput.note ?? '',
    reviewNote: parsedInput.reviewNote ?? '',
    keyTakeaways: parsedInput.keyTakeaways ?? [],
    createdAt: now,
    updatedAt: now,
  }
  const updatedOpportunity = {
    ...opportunity,
    updatedAt: now,
  }

  await opportunityRepository.createInterviewRound(round, updatedOpportunity)

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
    status: parsedInput.status ?? existingRound.status,
    result: parsedInput.result ?? existingRound.result,
    note: parsedInput.note ?? existingRound.note,
    reviewNote: parsedInput.reviewNote ?? existingRound.reviewNote,
    keyTakeaways: parsedInput.keyTakeaways ?? existingRound.keyTakeaways,
    updatedAt: now,
  }
  const updatedOpportunity = {
    ...opportunity,
    updatedAt: now,
  }

  await opportunityRepository.updateInterviewRound(updatedRound, updatedOpportunity)

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
