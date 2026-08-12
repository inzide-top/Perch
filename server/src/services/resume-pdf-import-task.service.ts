import crypto from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { resumePdfImportTasks } from '../db/schema'
import { getCurrentUserId } from '../context/current-user'
import { agentRunRepository } from '../repositories/agent-run.repository'
import { withBackgroundTaskCapacity } from './background-task.service'
import {
  extractSelectablePdfText,
  ResumePdfImportError,
  resumePdfImportPromptVersion,
  ResumePdfStructuredOutputError,
  structureResumePdfText,
  type ResumePdfImportAttemptLifecycle,
} from './resume-pdf-import.service'
import { ModelRequestError, type ModelConnection } from './ai/model-client'
import type { AgentRunError, AgentTokenUsage } from '@/types/opportunity'
import type { ResumePdfImportTaskRecord } from '@/shared/resume/pdf-import'

const ACTIVE_TASK_STALE_AFTER_MS = 20 * 60 * 1000

function toPublicTask(task: typeof resumePdfImportTasks.$inferSelect): ResumePdfImportTaskRecord {
  return {
    id: task.id,
    status: task.status,
    currentAttempt: task.currentAttempt,
    fileName: task.fileName,
    result: task.result,
    error: task.error,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
  }
}

function toTaskError(error: unknown) {
  if (error instanceof ResumePdfStructuredOutputError) {
    return { code: error.code, message: error.message, retryable: true }
  }

  if (error instanceof ResumePdfImportError) {
    return {
      code: error.statusCode === 402 ? 'model_quota_exhausted' : 'resume_pdf_import_failed',
      message: error.message,
      retryable: error.statusCode !== 400 && error.statusCode !== 413,
    }
  }

  return {
    code: 'resume_pdf_import_failed',
    message: error instanceof Error ? error.message : 'PDF 简历识别失败，请稍后重试',
    retryable: true,
  }
}

function toAgentRunError(error: unknown): AgentRunError {
  if (error instanceof ResumePdfStructuredOutputError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      validationIssues: error.validationIssues,
    }
  }

  if (error instanceof ModelRequestError) {
    return { code: error.code, message: error.message, retryable: error.retryable }
  }

  return {
    code: 'unknown',
    message: error instanceof Error ? error.message : 'PDF 简历识别发生未知错误',
    retryable: false,
  }
}

function getAttemptRawOutput(error: unknown) {
  if (error instanceof ResumePdfStructuredOutputError) return error.rawOutput
  if (error instanceof ModelRequestError) return error.rawOutput
  return null
}

function getAttemptTokenUsage(error: unknown): AgentTokenUsage | null {
  if (error instanceof ResumePdfStructuredOutputError) return error.tokenUsage
  if (error instanceof ModelRequestError) return error.tokenUsage
  return null
}

function createAttemptLifecycle(input: {
  taskId: string
  userId: string
  modelConnection: ModelConnection
}): ResumePdfImportAttemptLifecycle {
  const runStates = new Map<number, { runId: string; startedAtMs: number }>()
  const operationKey = `resume_pdf_import:${input.taskId}`

  return {
    async onAttemptStarted(context) {
      const attemptNumber = (await agentRunRepository.findLatestAttemptNumber(operationKey)) + 1
      const runId = crypto.randomUUID()
      const startedAt = new Date().toISOString()
      const run = await agentRunRepository.createResumePdfImportRun({
        id: runId,
        workflowType: 'resume_pdf_import',
        resumePdfImportTaskId: input.taskId,
        operationKey,
        attemptNumber,
        status: 'pending',
        modelName: input.modelConnection.modelName,
        promptVersion: resumePdfImportPromptVersion,
        input: context.input,
        rawOutput: null,
        parsedOutput: null,
        error: null,
        durationMs: null,
        tokenUsage: null,
        startedAt,
        finishedAt: null,
      })
      if (!run) throw new Error('PDF 简历识别 AgentRun 创建失败')
      await agentRunRepository.markResumePdfImportRunProcessing(run.id, startedAt)
      await db
        .update(resumePdfImportTasks)
        .set({ currentAttempt: attemptNumber, updatedAt: startedAt })
        .where(and(eq(resumePdfImportTasks.id, input.taskId), eq(resumePdfImportTasks.userId, input.userId)))
      runStates.set(context.attemptNumber, { runId: run.id, startedAtMs: Date.now() })
    },
    async onAttemptCompleted(context, result) {
      const state = runStates.get(context.attemptNumber)
      if (!state) return

      await agentRunRepository.completeResumePdfImportRun({
        runId: state.runId,
        rawOutput: result.rawOutput,
        parsedOutput: result.parsedOutput,
        tokenUsage: result.tokenUsage,
        durationMs: Date.now() - state.startedAtMs,
        finishedAt: new Date().toISOString(),
      })
    },
    async onAttemptFailed(context, error) {
      const state = runStates.get(context.attemptNumber)
      if (!state) return

      await agentRunRepository.failResumePdfImportRun({
        runId: state.runId,
        error: toAgentRunError(error),
        rawOutput: getAttemptRawOutput(error),
        tokenUsage: getAttemptTokenUsage(error),
        durationMs: Date.now() - state.startedAtMs,
        finishedAt: new Date().toISOString(),
      })
    },
  }
}

async function findOwnedTask(taskId: string, userId: string) {
  const [task] = await db
    .select()
    .from(resumePdfImportTasks)
    .where(and(eq(resumePdfImportTasks.id, taskId), eq(resumePdfImportTasks.userId, userId)))
    .limit(1)

  if (!task) throw new ResumePdfImportError('PDF 导入任务不存在', 404)
  return task
}

async function recoverStaleActiveTask(task: typeof resumePdfImportTasks.$inferSelect) {
  if (task.status !== 'pending' && task.status !== 'processing') return task

  const lastUpdatedAt = Date.parse(task.updatedAt)
  if (Number.isFinite(lastUpdatedAt) && Date.now() - lastUpdatedAt < ACTIVE_TASK_STALE_AFTER_MS) return task

  const failedAt = new Date().toISOString()
  const [recovered] = await db
    .update(resumePdfImportTasks)
    .set({
      status: 'failed',
      error: {
        code: 'resume_pdf_import_interrupted',
        message: 'PDF 识别任务可能因服务重启而中断，请重新识别',
        retryable: true,
      },
      updatedAt: failedAt,
      completedAt: failedAt,
    })
    .where(
      and(
        eq(resumePdfImportTasks.id, task.id),
        eq(resumePdfImportTasks.userId, task.userId),
        eq(resumePdfImportTasks.status, task.status),
        eq(resumePdfImportTasks.updatedAt, task.updatedAt),
      ),
    )
    .returning()

  return recovered ?? findOwnedTask(task.id, task.userId)
}

async function runResumePdfImportTask(input: {
  taskId: string
  userId: string
  fileName: string
  extracted: { text: string; pageCount: number; characterCount: number }
  modelConnection: ModelConnection
}) {
  const startedAt = new Date().toISOString()
  await db
    .update(resumePdfImportTasks)
    .set({ status: 'processing', error: null, updatedAt: startedAt })
    .where(and(eq(resumePdfImportTasks.id, input.taskId), eq(resumePdfImportTasks.userId, input.userId)))

  try {
    const result = await structureResumePdfText(
      {
        fileName: input.fileName,
        extracted: input.extracted,
        modelConnection: input.modelConnection,
      },
      {
        operationKey: `resume_pdf_import:${input.taskId}`,
        lifecycle: createAttemptLifecycle({
          taskId: input.taskId,
          userId: input.userId,
          modelConnection: input.modelConnection,
        }),
      },
    )
    const completedAt = new Date().toISOString()
    await db
      .update(resumePdfImportTasks)
      .set({
        status: 'completed',
        result,
        error: null,
        extractedText: null,
        updatedAt: completedAt,
        completedAt,
      })
      .where(and(eq(resumePdfImportTasks.id, input.taskId), eq(resumePdfImportTasks.userId, input.userId)))
  } catch (error) {
    const failedAt = new Date().toISOString()
    await db
      .update(resumePdfImportTasks)
      .set({ status: 'failed', error: toTaskError(error), updatedAt: failedAt, completedAt: failedAt })
      .where(and(eq(resumePdfImportTasks.id, input.taskId), eq(resumePdfImportTasks.userId, input.userId)))
  }
}

export async function createResumePdfImportTask(input: {
  fileName: string
  buffer: Buffer
  modelConnection: ModelConnection
}) {
  const userId = await getCurrentUserId()
  const extracted = await extractSelectablePdfText(input.buffer)
  const now = new Date().toISOString()
  const task = await withBackgroundTaskCapacity('resume_pdf_import', async () => {
    const [created] = await db
      .insert(resumePdfImportTasks)
      .values({
        id: crypto.randomUUID(),
        userId,
        status: 'pending',
        fileName: input.fileName,
        pageCount: extracted.pageCount,
        characterCount: extracted.characterCount,
        extractedText: extracted.text,
        result: null,
        error: null,
        modelName: input.modelConnection.modelName,
        currentAttempt: 0,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      })
      .returning()

    if (!created) throw new ResumePdfImportError('PDF 导入任务创建失败', 500)
    return created
  })

  void runResumePdfImportTask({
    taskId: task.id,
    userId,
    fileName: task.fileName,
    extracted,
    modelConnection: input.modelConnection,
  })
  return toPublicTask(task)
}

export async function getResumePdfImportTask(taskId: string) {
  const userId = await getCurrentUserId()
  const task = await recoverStaleActiveTask(await findOwnedTask(taskId, userId))
  return toPublicTask(task)
}

export async function retryResumePdfImportTask(taskId: string, modelConnection: ModelConnection) {
  const userId = await getCurrentUserId()
  const current = await recoverStaleActiveTask(await findOwnedTask(taskId, userId))
  if (current.status === 'pending' || current.status === 'processing') return toPublicTask(current)

  const retry = await withBackgroundTaskCapacity('resume_pdf_import', async () => {
    const existing = await recoverStaleActiveTask(await findOwnedTask(taskId, userId))
    if (existing.status === 'pending' || existing.status === 'processing') {
      return { task: existing, shouldLaunch: false }
    }
    if (!existing.extractedText) throw new ResumePdfImportError('原始 PDF 文本已清理，请重新选择文件')

    const now = new Date().toISOString()
    const [updated] = await db
      .update(resumePdfImportTasks)
      .set({
        status: 'pending',
        error: null,
        result: null,
        modelName: modelConnection.modelName,
        updatedAt: now,
        completedAt: null,
      })
      .where(
        and(
          eq(resumePdfImportTasks.id, taskId),
          eq(resumePdfImportTasks.userId, userId),
          eq(resumePdfImportTasks.status, existing.status),
        ),
      )
      .returning()
    if (updated) return { task: updated, shouldLaunch: true }

    const latest = await findOwnedTask(taskId, userId)
    return { task: latest, shouldLaunch: false }
  })

  const task = retry.task
  if (retry.shouldLaunch && task.extractedText) {
    void runResumePdfImportTask({
      taskId: task.id,
      userId,
      fileName: task.fileName,
      extracted: {
        text: task.extractedText,
        pageCount: task.pageCount,
        characterCount: task.characterCount,
      },
      modelConnection,
    })
  }

  return toPublicTask(task)
}
