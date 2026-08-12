import { defineStore } from 'pinia'
import type { ResumePdfImportTaskRecord } from '@/shared/resume/pdf-import'

export const useResumePdfImportReviewStore = defineStore('resume-pdf-import-review', {
  state: (): {
    taskId: string | null
    result: ResumePdfImportTaskRecord['result']
    revision: number
  } => ({
    taskId: null,
    result: null,
    revision: 0,
  }),

  actions: {
    open(task: ResumePdfImportTaskRecord) {
      if (!task.result) return
      this.taskId = task.id
      this.result = task.result
      this.revision += 1
    },

    clear() {
      this.taskId = null
      this.result = null
    },
  },
})
