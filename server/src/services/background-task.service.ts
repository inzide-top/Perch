import { and, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { actionStrategySnapshots, answerDeepEvaluations, jobAnalyses, reviewDocuments } from '../db/schema'

export type BackgroundTaskType = 'job_analysis' | 'answer_deep_evaluation' | 'review_extraction' | 'action_strategy'

export const backgroundTaskLimits = {
  job_analysis: 5,
  answer_deep_evaluation: 5,
  review_extraction: 5,
  action_strategy: 1,
  total: 10,
} as const

export type BackgroundTaskCounts = {
  jobAnalysis: number
  deepEvaluation: number
  reviewExtraction: number
  actionStrategy: number
  total: number
}

export class BackgroundTaskCapacityError extends Error {
  readonly statusCode = 429
  readonly code = 'background_task_capacity_exceeded'

  constructor(
    readonly taskType: BackgroundTaskType,
    readonly counts: BackgroundTaskCounts,
  ) {
    super(
      taskType === 'job_analysis'
        ? `当前最多同时执行 ${backgroundTaskLimits.job_analysis} 个 JD 分析任务，请等待已有任务完成。`
        : taskType === 'answer_deep_evaluation'
          ? `当前最多同时执行 ${backgroundTaskLimits.answer_deep_evaluation} 个深度点评任务，请等待已有任务完成。`
          : taskType === 'review_extraction'
            ? `当前最多同时执行 ${backgroundTaskLimits.review_extraction} 个真实复盘提取任务，请等待已有任务完成。`
            : `当前最多同时生成 ${backgroundTaskLimits.action_strategy} 个求职策略，请等待当前任务完成。`,
    )
    this.name = 'BackgroundTaskCapacityError'
  }
}

let admissionLock: Promise<void> = Promise.resolve()

async function withAdmissionLock<T>(operation: () => Promise<T>) {
  const previous = admissionLock
  let release!: () => void
  admissionLock = new Promise<void>((resolve) => {
    release = resolve
  })

  await previous
  try {
    return await operation()
  } finally {
    release()
  }
}

async function countActiveTasks(): Promise<BackgroundTaskCounts> {
  const [jobResult, deepResult, reviewResult, strategyResult] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(jobAnalyses)
      .where(and(isNull(jobAnalyses.sourceAnalysisId), inArray(jobAnalyses.status, ['pending', 'processing']))),
    db
      .select({ count: sql<number>`count(*)` })
      .from(answerDeepEvaluations)
      .where(inArray(answerDeepEvaluations.status, ['pending', 'processing'])),
    db
      .select({ count: sql<number>`count(*)` })
      .from(reviewDocuments)
      .where(inArray(reviewDocuments.status, ['pending', 'processing'])),
    db
      .select({ count: sql<number>`count(*)` })
      .from(actionStrategySnapshots)
      .where(inArray(actionStrategySnapshots.status, ['pending', 'processing'])),
  ])

  const jobAnalysis = Number(jobResult[0]?.count ?? 0)
  const deepEvaluation = Number(deepResult[0]?.count ?? 0)
  const reviewExtraction = Number(reviewResult[0]?.count ?? 0)
  const actionStrategy = Number(strategyResult[0]?.count ?? 0)

  return {
    jobAnalysis,
    deepEvaluation,
    reviewExtraction,
    actionStrategy,
    total: jobAnalysis + deepEvaluation + reviewExtraction + actionStrategy,
  }
}

/**
 * 在同一 API 进程内串行化“检查容量 + 入队”这段很短的临界区。
 * 模型请求本身不在锁内，因此不会因为一个慢模型阻塞其他任务的状态查询。
 */
export async function withBackgroundTaskCapacity<T>(taskType: BackgroundTaskType, operation: () => Promise<T>) {
  return withAdmissionLock(async () => {
    const counts = await countActiveTasks()
    const typeCount =
      taskType === 'job_analysis'
        ? counts.jobAnalysis
        : taskType === 'answer_deep_evaluation'
          ? counts.deepEvaluation
          : taskType === 'review_extraction'
            ? counts.reviewExtraction
            : counts.actionStrategy
    const typeLimit = backgroundTaskLimits[taskType]

    if (typeCount >= typeLimit || counts.total >= backgroundTaskLimits.total) {
      throw new BackgroundTaskCapacityError(taskType, counts)
    }

    return operation()
  })
}

export async function getBackgroundTaskCounts() {
  return countActiveTasks()
}
