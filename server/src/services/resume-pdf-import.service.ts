import { randomUUID } from 'node:crypto'
import { extractText, getDocumentProxy } from 'unpdf'
import { z } from 'zod'
import { parseModelOutputJson } from '../utils/model-output'
import { ModelRequestError, requestModelCompletion, type ModelConnection } from './ai/model-client'
import { normalizeResumePdfModelOutput } from './resume-pdf-output-normalizer'
import type { AgentRunError, AgentTokenUsage } from '@/types/opportunity'
import type { ResumePdfImportDraft, ResumePdfImportResponse } from '@/shared/resume/pdf-import'

const maxPdfPages = 12
const maxExtractedCharacters = 40_000
const minSelectableCharacters = 80
const maxStructureAttempts = 3
const retryDelaysMs = [0, 800, 1_600] as const

export const resumePdfImportPromptVersion = 'resume-pdf-import.v2'

const nullableText = z.string().trim().nullable().default(null)
const supportedResumeLanguages = ['英语', '西班牙语', '葡萄牙语', '法语', '日语', '其他'] as const

const extractedResumeSchema = z.object({
  title: nullableText,
  targetDirection: nullableText,
  name: nullableText,
  address: z.array(z.string().trim()).default([]),
  educationLevel: z.enum(['college_or_below', 'bachelor', 'master', 'doctor_or_above']).nullable().default(null),
  school: nullableText,
  major: nullableText,
  graduationYear: nullableText,
  currentStatus: z.enum(['employed', 'unemployed', 'fresh_graduate', 'studying', 'interning']).nullable().default(null),
  jobSearchIdentity: z.enum(['campus', 'experienced', 'internship']).nullable().default(null),
  portfolioLinks: z
    .array(z.object({ label: z.string().trim().default('作品链接'), url: z.string().trim() }))
    .default([]),
  languages: z
    .array(
      z.object({
        language: z.enum(supportedResumeLanguages),
        level: z.enum(['basic', 'reading_writing', 'daily_communication', 'working_professional', 'fluent']),
      }),
    )
    .default([]),
  workExperiences: z
    .array(
      z.object({
        companyName: z.string().trim().default(''),
        industry: z.string().trim().default(''),
        department: z.string().trim().default(''),
        jobTitle: z.string().trim().default(''),
        period: z
          .object({ start: z.string().trim().default(''), end: z.string().trim().default('') })
          .default({ start: '', end: '' }),
      }),
    )
    .default([]),
  comment: nullableText,
  skills: nullableText,
  projects: z
    .array(
      z.object({
        name: z.string().trim().default(''),
        role: z.string().trim().default(''),
        techStack: z.string().trim().default(''),
        description: z.string().trim().default(''),
        content: z.string().trim().default(''),
        outcomes: z.string().trim().default(''),
      }),
    )
    .default([]),
})

type ExtractedResume = z.output<typeof extractedResumeSchema>

type StructuredResumePdfDraft = Omit<
  ExtractedResume,
  'portfolioLinks' | 'languages' | 'workExperiences' | 'projects'
> & {
  portfolioLinks: Array<ExtractedResume['portfolioLinks'][number] & { id: string }>
  languages: Array<ExtractedResume['languages'][number] & { id: string }>
  workExperiences: Array<ExtractedResume['workExperiences'][number] & { id: string }>
  projects: Array<ExtractedResume['projects'][number] & { id: string }>
}

export class ResumePdfImportError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message)
    this.name = 'ResumePdfImportError'
  }
}

export class ResumePdfStructuredOutputError extends ResumePdfImportError {
  readonly code = 'structured_output_validation_failed' as const
  readonly retryable = true

  constructor(
    message: string,
    readonly rawOutput: string,
    readonly tokenUsage: AgentTokenUsage | null,
    readonly validationIssues: NonNullable<AgentRunError['validationIssues']>,
  ) {
    super(message, 422)
    this.name = 'ResumePdfStructuredOutputError'
  }
}

export type ResumePdfImportAttemptContext = {
  operationKey: string
  attemptNumber: number
  promptVersion: string
  input: {
    fileName: string
    pageCount: number
    characterCount: number
    extractedText: string
  }
}

export type ResumePdfImportAttemptLifecycle = {
  onAttemptStarted?: (context: ResumePdfImportAttemptContext) => Promise<void> | void
  onAttemptCompleted?: (
    context: ResumePdfImportAttemptContext,
    result: { rawOutput: string; parsedOutput: ResumePdfImportResponse; tokenUsage: AgentTokenUsage | null },
  ) => Promise<void> | void
  onAttemptFailed?: (context: ResumePdfImportAttemptContext, error: unknown) => Promise<void> | void
}

type ResumePdfStructureDependencies = {
  requestCompletion?: typeof requestModelCompletion
  operationKey?: string
  lifecycle?: ResumePdfImportAttemptLifecycle
  waitBeforeRetry?: (delayMs: number) => Promise<void>
}

const systemPrompt = `你是 PERCH 的简历结构化助手。请只依据用户提供的 PDF 文本提取事实，只返回一个完整、合法的 JSON 对象，不要返回 Markdown。
不得补写原文不存在的公司、时间、技能、项目结果或求职状态。
必须使用以下字段和类型，不得改名或增加其他字段：
- title,targetDirection,name,school,major,graduationYear,comment: string|null
- address: string[]
- educationLevel,currentStatus,jobSearchIdentity: 下方枚举值或 null
- portfolioLinks: Array<{label:string,url:string}>
- languages: Array<{language:string,level:string}>，language 只能使用中文枚举：英语|西班牙语|葡萄牙语|法语|日语|其他；原文写 English 时必须输出“英语”，不在列表的语言输出“其他”
- workExperiences: Array<{companyName:string,industry:string,department:string,jobTitle:string,period:{start:string,end:string}}>
- skills: string|null。多个技能必须使用英文逗号加空格（“, ”）连接，绝对不能返回数组
- projects: Array<{name:string,role:string,techStack:string,description:string,content:string,outcomes:string}>。techStack 多项必须使用英文逗号加空格（“, ”）连接，绝对不能返回数组
无法确定的顶层单值字段返回 null，数组字段返回 []；数组对象内无法确定的字符串返回空字符串，不得省略对象键。
枚举值：educationLevel=college_or_below|bachelor|master|doctor_or_above；
currentStatus=employed|unemployed|fresh_graduate|studying|interning；
jobSearchIdentity=campus|experienced|internship；
language.level=basic|reading_writing|daily_communication|working_professional|fluent。
工作起止时间尽量写成 YYYY-MM；“至今”写 present。title 优先使用“姓名-目标岗位”，无法确定时返回 null。
projects 中 description 表示项目背景和目标，content 表示本人负责的工作，不要把两者混成同一段。
仅用于说明类型的最小示例（不要复制示例内容）：
{"title":null,"targetDirection":null,"name":null,"address":[],"educationLevel":null,"school":null,"major":null,"graduationYear":null,"currentStatus":null,"jobSearchIdentity":null,"portfolioLinks":[],"languages":[],"workExperiences":[],"comment":null,"skills":"Vue 3, TypeScript","projects":[]}`

function buildUserPrompt(fileName: string, text: string, repairMessage?: string) {
  return [
    `文件名：${fileName}`,
    repairMessage ? `上次输出无法使用：${repairMessage}。请重新输出完整 JSON。` : '',
    '以下是 PDF 提取文本：',
    text,
  ]
    .filter(Boolean)
    .join('\n\n')
}

function normalizeCity(city: string) {
  return city.trim().replace(/市$/, '')
}

function withIds(parsed: ExtractedResume): StructuredResumePdfDraft {
  return {
    ...parsed,
    address: [...new Set(parsed.address.map(normalizeCity).filter(Boolean))],
    portfolioLinks: parsed.portfolioLinks.filter((item) => item.url).map((item) => ({ id: randomUUID(), ...item })),
    languages: parsed.languages.filter((item) => item.language).map((item) => ({ id: randomUUID(), ...item })),
    workExperiences: parsed.workExperiences
      .filter(
        (item) =>
          item.companyName || item.industry || item.department || item.jobTitle || item.period.start || item.period.end,
      )
      .map((item) => ({ id: randomUUID(), ...item })),
    projects: parsed.projects
      .filter((item) => Object.values(item).some((value) => value.trim()))
      .map((item) => ({ id: randomUUID(), ...item })),
  }
}

function listRecognizedFields(draft: ResumePdfImportDraft) {
  const fields: string[] = []
  const scalarFields = [
    'title',
    'targetDirection',
    'name',
    'educationLevel',
    'school',
    'major',
    'graduationYear',
    'currentStatus',
    'jobSearchIdentity',
    'comment',
    'skills',
  ] as const

  for (const field of scalarFields) {
    if (draft[field]) fields.push(field)
  }

  for (const field of ['address', 'portfolioLinks', 'languages', 'workExperiences', 'projects'] as const) {
    if (draft[field].length > 0) fields.push(field)
  }

  return fields
}

function toValidationIssues(error: unknown): NonNullable<AgentRunError['validationIssues']> {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => ({
      path: issue.path.map((part) => (typeof part === 'symbol' ? String(part) : part)),
      code: issue.code,
      message: issue.message,
    }))
  }

  return [
    {
      path: [],
      code: 'custom',
      message: error instanceof Error ? error.message : '模型返回的简历结构无法使用',
    },
  ]
}

function toResumePdfImportError(error: unknown) {
  if (error instanceof ResumePdfImportError) return error
  if (!(error instanceof ModelRequestError)) {
    return new ResumePdfImportError(error instanceof Error ? error.message : 'PDF 简历识别失败', 500)
  }

  const statusCode =
    error.code === 'model_quota_exhausted'
      ? 402
      : error.code === 'rate_limited'
        ? 429
        : error.code === 'model_request_failed' || error.code === 'timeout'
          ? 503
          : 400
  return new ResumePdfImportError(error.message, statusCode)
}

function isRetryableAttemptError(error: unknown) {
  if (error instanceof ResumePdfStructuredOutputError) return true
  return error instanceof ModelRequestError && error.retryable
}

function formatRepairMessage(error: ResumePdfStructuredOutputError) {
  const fieldContracts: Record<string, string> = {
    root: '必须返回完整、合法的 JSON 对象',
    address: '必须是 string[]，没有内容时返回 []',
    portfolioLinks: '必须是 Array<{label:string,url:string}>',
    languages: '必须是 Array<{language:英语|西班牙语|葡萄牙语|法语|日语|其他,level:枚举值}>，语言名称必须使用中文',
    workExperiences:
      '必须是 Array<{companyName:string,industry:string,department:string,jobTitle:string,period:{start:string,end:string}}>',
    skills: '必须是 string|null；多个技能用英文逗号加空格连接，绝对不能返回数组',
    projects:
      '必须是 Array<{name:string,role:string,techStack:string,description:string,content:string,outcomes:string}>；techStack 多项用英文逗号加空格连接，不能是数组',
  }
  const issuesByRoot = new Map<string, string[]>()

  for (const issue of error.validationIssues) {
    const root = String(issue.path[0] ?? 'root')
    const issues = issuesByRoot.get(root) ?? []
    if (issues.length < 2) {
      issues.push(`${issue.path.length ? issue.path.join('.') : 'root'}: ${issue.message}`)
      issuesByRoot.set(root, issues)
    }
  }

  const details = [...issuesByRoot.entries()]
    .map(([root, issues]) => `${root}：${fieldContracts[root] ?? '必须符合字段定义'}；当前错误：${issues.join('，')}`)
    .join('；')

  return details || error.message
}

function wait(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}

export async function extractSelectablePdfText(buffer: Buffer) {
  if (buffer.subarray(0, 5).toString() !== '%PDF-') {
    throw new ResumePdfImportError('文件内容不是有效的 PDF，请重新选择')
  }

  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | null = null

  try {
    pdf = await getDocumentProxy(new Uint8Array(buffer))
    if (pdf.numPages > maxPdfPages) {
      throw new ResumePdfImportError(`PDF 最多支持 ${maxPdfPages} 页，当前文件有 ${pdf.numPages} 页`, 413)
    }

    const result = await extractText(pdf, { mergePages: false })
    const pages = Array.isArray(result.text) ? result.text : [result.text]
    const text = pages
      .map((page, index) => `--- 第 ${index + 1} 页 ---\n${page}`)
      .join('\n\n')
      .trim()

    if (text.replace(/\s/g, '').length < minSelectableCharacters) {
      throw new ResumePdfImportError('没有从 PDF 中提取到足够文本。扫描件或图片型 PDF 暂不支持，请上传可复制文字的 PDF')
    }
    if (text.length > maxExtractedCharacters) {
      throw new ResumePdfImportError('PDF 文本内容过长，请精简到 4 万字符以内后重试', 413)
    }

    return { text, pageCount: pdf.numPages, characterCount: text.length }
  } catch (error) {
    if (error instanceof ResumePdfImportError) throw error
    throw new ResumePdfImportError('PDF 无法读取，文件可能已加密或损坏')
  } finally {
    const destroy = (pdf as { destroy?: () => Promise<void> | void } | null)?.destroy
    if (destroy && pdf) await Promise.resolve(destroy.call(pdf)).catch(() => undefined)
  }
}

export async function importResumeFromPdf(
  input: { fileName: string; buffer: Buffer; modelConnection: ModelConnection },
  dependencies: {
    extractPdfText?: typeof extractSelectablePdfText
    requestCompletion?: typeof requestModelCompletion
    operationKey?: string
    lifecycle?: ResumePdfImportAttemptLifecycle
    waitBeforeRetry?: (delayMs: number) => Promise<void>
  } = {},
): Promise<ResumePdfImportResponse> {
  const extractPdfText = dependencies.extractPdfText ?? extractSelectablePdfText
  const extracted = await extractPdfText(input.buffer)

  return structureResumePdfText(
    {
      fileName: input.fileName,
      extracted,
      modelConnection: input.modelConnection,
    },
    {
      requestCompletion: dependencies.requestCompletion,
      operationKey: dependencies.operationKey,
      lifecycle: dependencies.lifecycle,
      waitBeforeRetry: dependencies.waitBeforeRetry,
    },
  )
}

export async function structureResumePdfText(
  input: {
    fileName: string
    extracted: { text: string; pageCount: number; characterCount: number }
    modelConnection: ModelConnection
  },
  dependencies: ResumePdfStructureDependencies = {},
): Promise<ResumePdfImportResponse> {
  const requestCompletion = dependencies.requestCompletion ?? requestModelCompletion
  const operationKey = dependencies.operationKey ?? `resume-pdf-import:${randomUUID()}`
  const waitBeforeRetry = dependencies.waitBeforeRetry ?? wait
  let repairMessage: string | undefined

  for (let attempt = 1; attempt <= maxStructureAttempts; attempt += 1) {
    const context: ResumePdfImportAttemptContext = {
      operationKey,
      attemptNumber: attempt,
      promptVersion: resumePdfImportPromptVersion,
      input: {
        fileName: input.fileName,
        pageCount: input.extracted.pageCount,
        characterCount: input.extracted.characterCount,
        extractedText: input.extracted.text,
      },
    }
    await dependencies.lifecycle?.onAttemptStarted?.(context)

    try {
      const completion = await requestCompletion(
        operationKey,
        input.modelConnection,
        systemPrompt,
        buildUserPrompt(input.fileName, input.extracted.text, repairMessage),
        { temperature: 0, maxTokens: 6_000 },
      )

      let result: ResumePdfImportResponse
      try {
        const normalized = normalizeResumePdfModelOutput(parseModelOutputJson(completion.rawOutput))
        const parsed = extractedResumeSchema.parse(normalized.value)
        const draft = withIds(parsed) satisfies ResumePdfImportDraft
        const recognizedFields = listRecognizedFields(draft)
        if (recognizedFields.length === 0) throw new Error('未识别到任何简历字段')

        const missingRequiredFields = [
          !draft.targetDirection && 'targetDirection',
          !draft.name && 'name',
          !draft.skills && 'skills',
        ].filter((field): field is string => Boolean(field))

        result = {
          source: {
            fileName: input.fileName,
            pageCount: input.extracted.pageCount,
            characterCount: input.extracted.characterCount,
          },
          draft,
          recognizedFields,
          missingRequiredFields,
          warnings: [
            ...normalized.warnings,
            ...(missingRequiredFields.length ? ['部分必填信息没有在 PDF 中找到，应用草稿后请手动补充。'] : []),
          ],
        }
      } catch (error) {
        throw new ResumePdfStructuredOutputError(
          `第 ${attempt} 次模型输出未通过简历结构校验`,
          completion.rawOutput,
          completion.tokenUsage,
          toValidationIssues(error),
        )
      }

      await dependencies.lifecycle?.onAttemptCompleted?.(context, {
        rawOutput: completion.rawOutput,
        parsedOutput: result,
        tokenUsage: completion.tokenUsage,
      })
      return result
    } catch (error) {
      await dependencies.lifecycle?.onAttemptFailed?.(context, error)
      if (!isRetryableAttemptError(error) || attempt === maxStructureAttempts) throw toResumePdfImportError(error)

      if (error instanceof ResumePdfStructuredOutputError) repairMessage = formatRepairMessage(error)
      await waitBeforeRetry(retryDelaysMs[attempt] ?? retryDelaysMs.at(-1)!)
    }
  }

  throw new ResumePdfImportError('简历识别失败', 422)
}
