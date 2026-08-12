import type { JobAnalysisProgress } from '@/types/opportunity'
import { getJobAnalyses } from './job-analysis.service'
import { getAnswerDeepEvaluationStatus, InterviewNotFoundError } from './interview.service'
import { getActionStrategySnapshotStatus } from './action-strategy.service'
import { backgroundTaskStatusInputSchema, type BackgroundTaskReference } from '../schemas/background-task.schema'
import { getResumePdfImportTask } from './resume-pdf-import-task.service'
import type { ResumePdfImportTaskRecord } from '@/shared/resume/pdf-import'

type JobAnalysisStatusSummary = Omit<JobAnalysisProgress, 'result'> & { result: null }

type DeepEvaluationStatus = {
  id: string
  turnId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  result: null
  error: unknown
  updatedAt: string
  completedAt: string | null
}

export type BackgroundTaskStatus =
  | {
      type: 'job_analysis'
      opportunityId: string
      analysis: JobAnalysisStatusSummary | null
    }
  | {
      type: 'answer_deep_evaluation'
      sessionId: string
      turnId: string
      evaluation: DeepEvaluationStatus | null
    }
  | {
      type: 'action_strategy'
      snapshotId: string
      strategy: {
        id: string
        status: 'pending' | 'processing' | 'completed' | 'failed'
        error: unknown
        updatedAt: string
        completedAt: string | null
      } | null
    }
  | {
      type: 'resume_pdf_import'
      taskId: string
      importTask: ResumePdfImportTaskRecord | null
    }

async function getDeepEvaluationStatus(
  reference: Extract<BackgroundTaskReference, { type: 'answer_deep_evaluation' }>,
) {
  try {
    const evaluation = await getAnswerDeepEvaluationStatus(reference.sessionId, reference.turnId)
    return {
      ...evaluation,
      result: null,
      status: evaluation.status === 'cancelled' ? ('failed' as const) : evaluation.status,
    }
  } catch (error) {
    if (error instanceof InterviewNotFoundError) return null
    throw error
  }
}

export async function getBackgroundTaskStatuses(input: unknown): Promise<BackgroundTaskStatus[]> {
  const parsedInput = backgroundTaskStatusInputSchema.parse(input)
  const jobReferences = parsedInput.tasks.filter(
    (task): task is Extract<BackgroundTaskReference, { type: 'job_analysis' }> => task.type === 'job_analysis',
  )
  const deepReferences = parsedInput.tasks.filter(
    (task): task is Extract<BackgroundTaskReference, { type: 'answer_deep_evaluation' }> =>
      task.type === 'answer_deep_evaluation',
  )
  const strategyReferences = parsedInput.tasks.filter(
    (task): task is Extract<BackgroundTaskReference, { type: 'action_strategy' }> => task.type === 'action_strategy',
  )
  const resumePdfReferences = parsedInput.tasks.filter(
    (task): task is Extract<BackgroundTaskReference, { type: 'resume_pdf_import' }> =>
      task.type === 'resume_pdf_import',
  )

  const [jobItems, deepItems, strategyItems, resumePdfItems] = await Promise.all([
    jobReferences.length
      ? getJobAnalyses(
          jobReferences.map((task) => task.opportunityId),
          { includeResult: false },
        )
      : [],
    Promise.all(
      deepReferences.map(async (reference) => ({
        reference,
        evaluation: await getDeepEvaluationStatus(reference),
      })),
    ),
    Promise.all(
      strategyReferences.map(async (reference) => ({
        reference,
        strategy: await getActionStrategySnapshotStatus(reference.snapshotId),
      })),
    ),
    Promise.all(
      resumePdfReferences.map(async (reference) => ({
        reference,
        importTask: await getResumePdfImportTask(reference.taskId).catch(() => null),
      })),
    ),
  ])

  const jobByOpportunityId = new Map(
    jobItems.map((item) => [item.opportunityId, item.analysis ? { ...item.analysis, result: null } : null]),
  )
  const deepByTurnId = new Map(deepItems.map((item) => [item.reference.turnId, item.evaluation]))
  const strategyById = new Map(strategyItems.map((item) => [item.reference.snapshotId, item.strategy]))
  const resumePdfById = new Map(resumePdfItems.map((item) => [item.reference.taskId, item.importTask]))

  return parsedInput.tasks.map((task) => {
    if (task.type === 'job_analysis') {
      return {
        type: task.type,
        opportunityId: task.opportunityId,
        analysis: jobByOpportunityId.get(task.opportunityId) ?? null,
      }
    }

    if (task.type === 'action_strategy') {
      return {
        type: task.type,
        snapshotId: task.snapshotId,
        strategy: strategyById.get(task.snapshotId) ?? null,
      }
    }

    if (task.type === 'resume_pdf_import') {
      return {
        type: task.type,
        taskId: task.taskId,
        importTask: resumePdfById.get(task.taskId) ?? null,
      }
    }

    return {
      type: task.type,
      sessionId: task.sessionId,
      turnId: task.turnId,
      evaluation: deepByTurnId.get(task.turnId) ?? null,
    }
  })
}
