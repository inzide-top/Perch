import { randomUUID } from 'node:crypto'
import { extractText, getDocumentProxy } from 'unpdf'
import { z } from 'zod'
import { parseModelOutputJson } from '../utils/model-output'
import { ModelRequestError, requestModelCompletion, type ModelConnection } from './ai/model-client'
import type { ResumePdfImportDraft, ResumePdfImportResponse } from '@/shared/resume/pdf-import'

const maxPdfPages = 12
const maxExtractedCharacters = 40_000
const minSelectableCharacters = 80

const nullableText = z.string().trim().nullable().default(null)
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
        language: z.string().trim(),
        level: z.enum(['basic', 'reading_writing', 'daily_communication', 'working_professional', 'fluent']),
      }),
    )
    .default([]),
  workExperiences: z
    .array(
      z.object({
        companyName: z.string().trim(),
        industry: z.string().trim().default(''),
        department: z.string().trim().default(''),
        jobTitle: z.string().trim(),
        period: z.object({ start: z.string().trim().default(''), end: z.string().trim().default('') }),
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

const systemPrompt = `你是 PERCH 的简历结构化助手。请只依据用户提供的 PDF 文本提取事实，返回一个 JSON 对象。
不得补写原文不存在的公司、时间、技能、项目结果或求职状态。
字段必须为：title,targetDirection,name,address,educationLevel,school,major,graduationYear,currentStatus,
jobSearchIdentity,portfolioLinks,languages,workExperiences,comment,skills,projects。
无法确定的单值字段返回 null，数组字段返回 []。
枚举值：educationLevel=college_or_below|bachelor|master|doctor_or_above；
currentStatus=employed|unemployed|fresh_graduate|studying|interning；
jobSearchIdentity=campus|experienced|internship；
language.level=basic|reading_writing|daily_communication|working_professional|fluent。
工作起止时间尽量写成 YYYY-MM；“至今”写 present。title 优先使用“姓名-目标岗位”，无法确定时返回 null。
projects 中 description 表示项目背景和目标，content 表示本人负责的工作，不要把两者混成同一段。`

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
      .filter((item) => item.companyName || item.jobTitle)
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
    { requestCompletion: dependencies.requestCompletion },
  )
}

export async function structureResumePdfText(
  input: {
    fileName: string
    extracted: { text: string; pageCount: number; characterCount: number }
    modelConnection: ModelConnection
  },
  dependencies: { requestCompletion?: typeof requestModelCompletion } = {},
): Promise<ResumePdfImportResponse> {
  const requestCompletion = dependencies.requestCompletion ?? requestModelCompletion
  let repairMessage: string | undefined

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let completion: Awaited<ReturnType<typeof requestModelCompletion>>
    try {
      completion = await requestCompletion(
        `resume-pdf-import:${randomUUID()}`,
        input.modelConnection,
        systemPrompt,
        buildUserPrompt(input.fileName, input.extracted.text, repairMessage),
        { temperature: 0, maxTokens: 6_000 },
      )
    } catch (error) {
      if (!(error instanceof ModelRequestError)) throw error

      const statusCode =
        error.code === 'model_quota_exhausted'
          ? 402
          : error.code === 'rate_limited'
            ? 429
            : error.code === 'model_request_failed'
              ? 503
              : 400
      throw new ResumePdfImportError(error.message, statusCode)
    }

    try {
      const parsed = extractedResumeSchema.parse(parseModelOutputJson(completion.rawOutput))
      const draft = withIds(parsed) satisfies ResumePdfImportDraft
      const recognizedFields = listRecognizedFields(draft)
      if (recognizedFields.length === 0) throw new Error('未识别到任何简历字段')

      const missingRequiredFields = [
        !draft.targetDirection && 'targetDirection',
        !draft.name && 'name',
        !draft.skills && 'skills',
      ].filter((field): field is string => Boolean(field))

      return {
        source: {
          fileName: input.fileName,
          pageCount: input.extracted.pageCount,
          characterCount: input.extracted.characterCount,
        },
        draft,
        recognizedFields,
        missingRequiredFields,
        warnings: missingRequiredFields.length ? ['部分必填信息没有在 PDF 中找到，应用草稿后请手动补充。'] : [],
      }
    } catch (error) {
      repairMessage = error instanceof Error ? error.message : '结构化结果不完整'
      if (attempt === 2) {
        throw new ResumePdfImportError('模型连续两次未返回可用的简历结构，请稍后重试', 422)
      }
    }
  }

  throw new ResumePdfImportError('简历识别失败', 422)
}
