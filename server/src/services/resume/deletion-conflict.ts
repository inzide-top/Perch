export type ResumeInterviewHistoryConflictDetails = {
  archivedSessionCount: number
  unarchivedSessionCount: number
}

export class ResumeInterviewHistoryConflictError extends Error {
  statusCode = 409
  code = 'resume_interview_history_conflict' as const
  details: ResumeInterviewHistoryConflictDetails

  constructor(details: ResumeInterviewHistoryConflictDetails) {
    super(
      details.archivedSessionCount > 0
        ? '该简历仍被已归档模拟面试使用，请彻底删除关联记录后再删除简历'
        : '该简历仍被模拟面试使用，请先结束并归档关联记录',
    )
    this.name = 'ResumeInterviewHistoryConflictError'
    this.details = details
  }
}

export function summarizeResumeInterviewHistoryConflict(
  sessions: Array<{ archivedAt: string | null }>,
): ResumeInterviewHistoryConflictDetails {
  return {
    archivedSessionCount: sessions.filter((session) => session.archivedAt !== null).length,
    unarchivedSessionCount: sessions.filter((session) => session.archivedAt === null).length,
  }
}
