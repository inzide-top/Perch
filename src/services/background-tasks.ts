import type { AnswerDeepEvaluationResult } from '@/shared/interview/schemas'
import type { JobAnalysisProgress } from '@/types/opportunity'
import { request } from './http'

export type BackgroundTaskReference =
  | { type: 'job_analysis'; opportunityId: string }
  | { type: 'answer_deep_evaluation'; sessionId: string; turnId: string }
  | { type: 'action_strategy'; snapshotId: string }

function toBackgroundTaskReference(task: BackgroundTaskReference): BackgroundTaskReference {
  return task.type === 'job_analysis'
    ? { type: task.type, opportunityId: task.opportunityId }
    : task.type === 'answer_deep_evaluation'
      ? { type: task.type, sessionId: task.sessionId, turnId: task.turnId }
      : { type: task.type, snapshotId: task.snapshotId }
}

export type BackgroundTaskStatus = BackgroundTaskReference &
  (
    | { type: 'job_analysis'; analysis: JobAnalysisProgress | null }
    | {
        type: 'answer_deep_evaluation'
        evaluation: {
          id: string
          turnId: string
          status: 'pending' | 'processing' | 'completed' | 'failed'
          result: AnswerDeepEvaluationResult | null
          error: unknown
          updatedAt: string
          completedAt: string | null
        } | null
      }
    | {
        type: 'action_strategy'
        strategy: {
          id: string
          status: 'pending' | 'processing' | 'completed' | 'failed'
          error: unknown
          updatedAt: string
          completedAt: string | null
        } | null
      }
  )

export const backgroundTaskApi = {
  getStatuses(tasks: BackgroundTaskReference[]) {
    return request.post<{ tasks: BackgroundTaskStatus[] }>('/background-tasks/status', {
      tasks: tasks.map(toBackgroundTaskReference),
    })
  },

  async getCompletedJobAnalysis(opportunityId: string) {
    const query = new URLSearchParams({ opportunityIds: opportunityId, includeResult: 'true' })
    const [item] = await request.get<Array<{ opportunityId: string; analysis: JobAnalysisProgress | null }>>(
      `/opportunities/analyses?${query.toString()}`,
    )
    return item?.analysis ?? null
  },

  getCompletedDeepEvaluation(sessionId: string, turnId: string) {
    return request.get<{
      id: string
      turnId: string
      status: 'pending' | 'processing' | 'completed' | 'failed'
      result: AnswerDeepEvaluationResult | null
      error: unknown
      updatedAt: string
      completedAt: string | null
    }>(`/interview-sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/deep-evaluation`)
  },
}
