import { useBackgroundTaskStore } from '@/stores/background-tasks'
import { useInterviewStore } from '@/stores/interview'
import { useOpportunityStore } from '@/stores/opportunity'

let cleanup: (() => void) | null = null

/** 将全局后台任务的批量状态同步回各业务 Store；页面组件不再各自维护轮询。 */
export function setupBackgroundTaskSync() {
  cleanup?.()

  const backgroundTaskStore = useBackgroundTaskStore()
  const opportunityStore = useOpportunityStore()
  const interviewStore = useInterviewStore()
  cleanup = backgroundTaskStore.subscribe((task) => {
    if (task.type === 'job_analysis') opportunityStore.applyBackgroundAnalysisTask(task)
    if (task.type === 'answer_deep_evaluation') interviewStore.applyBackgroundDeepEvaluation(task)
  })

  return cleanup
}

export function teardownBackgroundTaskSync() {
  cleanup?.()
  cleanup = null
}
