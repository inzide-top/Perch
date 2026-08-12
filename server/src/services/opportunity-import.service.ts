import { z } from 'zod'
import {
  importJobOpportunitiesFromUrlsInputSchema,
  importJobOpportunityFromTextInputSchema,
  importJobOpportunityFromUrlInputSchema,
} from '../schemas/opportunity.schema'
import { parseModelOutputJson } from '../utils/model-output'
import { cancelModelRequest, ModelRequestError, requestModelCompletion } from './ai/model-client'

const firecrawlApiUrl = 'https://api.firecrawl.dev/v2/scrape'
const firecrawlTimeoutMs = 60_000

const jobImportJsonSchema = {
  type: 'object',
  properties: {
    company: {
      type: 'string',
      description: '招聘该岗位的公司或组织名称。页面没有明确说明时返回空字符串。',
    },
    jobTitle: {
      type: 'string',
      description: '职位名称。页面没有明确说明时返回空字符串。',
    },
    address: {
      type: 'array',
      items: { type: 'string' },
      description: '页面明确列出的工作城市或地点，最多五项；没有时返回空数组。',
    },
    businessContext: {
      type: 'string',
      description: '公司、团队、产品、业务线或岗位背景；没有明确内容时返回空字符串。',
    },
    responsibilities: {
      type: 'array',
      items: { type: 'string' },
      description: '入职后需要承担的工作、职责和交付内容；没有时返回空数组。',
    },
    requirements: {
      type: 'array',
      items: { type: 'string' },
      description: '候选人必须具备的经验、技能、学历和能力要求；没有时返回空数组。',
    },
    bonusPoints: {
      type: 'array',
      items: { type: 'string' },
      description: '优先条件、加分项和非必需偏好；没有时返回空数组。',
    },
  },
  additionalProperties: false,
} as const

const jobImportExtractionSchema = z
  .object({
    company: z.unknown().optional(),
    jobTitle: z.unknown().optional(),
    address: z.unknown().optional(),
    businessContext: z.unknown().optional(),
    responsibilities: z.unknown().optional(),
    requirements: z.unknown().optional(),
    bonusPoints: z.unknown().optional(),
  })
  .passthrough()

const firecrawlResponseSchema = z
  .object({
    success: z.boolean(),
    data: z
      .object({
        json: z.unknown().optional(),
        metadata: z
          .object({
            sourceURL: z.string().optional(),
            url: z.string().optional(),
          })
          .passthrough()
          .optional(),
        warning: z.string().optional(),
      })
      .passthrough()
      .optional(),
    error: z.string().optional(),
  })
  .passthrough()

export type ImportedJobOpportunityField = 'company' | 'jobTitle' | 'description'

export type JobOpportunityImportSource =
  { type: 'url'; label: string; url: string } | { type: 'text'; label: string; url: null }

export type JobOpportunityImportPreview = {
  source: JobOpportunityImportSource
  /** 兼容已有前端调用；文本导入没有 URL。 */
  sourceUrl: string | null
  company: string
  jobTitle: string
  address: string[]
  introduction: string
  description: string
  missingRequiredFields: ImportedJobOpportunityField[]
  warning: string | null
}

export type JobOpportunityBatchImportItem =
  | {
      url: string
      status: 'ready'
      preview: JobOpportunityImportPreview
    }
  | {
      url: string
      status: 'failed'
      error: string
      statusCode: number
    }

type ImportDependencies = {
  fetch?: typeof fetch
  apiKey?: string
  signal?: AbortSignal
}

type TextImportDependencies = {
  requestCompletion?: typeof requestModelCompletion
  signal?: AbortSignal
}

export class OpportunityImportError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'OpportunityImportError'
    this.statusCode = statusCode
  }
}

function getFirecrawlApiKey() {
  // 兼容项目里已经使用过的拼写；新环境统一使用官方变量名。
  return process.env.FIRECRAWL_API_KEY?.trim()
}

function normalizePublicUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new OpportunityImportError('仅支持 http 或 https 岗位页面网址', 400)
  }

  if (url.username || url.password) {
    throw new OpportunityImportError('岗位页面网址不能包含用户名或密码', 400)
  }

  const hostname = url.hostname.toLowerCase()
  const isPrivateHostname =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '::1' ||
    hostname.startsWith('127.') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)

  if (isPrivateHostname) {
    throw new OpportunityImportError('请输入公网可访问的岗位页面网址', 400)
  }

  url.hash = ''
  return url.toString()
}

function readText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeImportedCity(value: unknown) {
  const city = readText(value)
  if (city.length <= 2) return city

  return city.replace(/市$/, '')
}

function readAddress(value: unknown) {
  const source = Array.isArray(value)
    ? value.flatMap((item) => (typeof item === 'string' ? item.split(/[,，、;/]/) : []))
    : typeof value === 'string'
      ? value.split(/[,，、;/]/)
      : []
  return [...new Set(source.map(normalizeImportedCity).filter(Boolean))].slice(0, 5)
}

function readTextList(value: unknown) {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n/) : []

  return source
    .map((item) =>
      readText(item)
        .replace(/^[-*•\d.、)）\s]+/, '')
        .trim(),
    )
    .filter(Boolean)
    .slice(0, 80)
}

function formatSection(title: string, items: string[]) {
  if (items.length === 0) return ''

  return `${title}\n${items.map((item) => `- ${item}`).join('\n')}`
}

function parseExtraction(raw: unknown) {
  const parsed = jobImportExtractionSchema.safeParse(raw)
  if (!parsed.success) {
    throw new OpportunityImportError('识别服务没有返回可读取的岗位字段，请重试或改为手动填写', 422)
  }

  return {
    company: readText(parsed.data.company),
    jobTitle: readText(parsed.data.jobTitle),
    address: readAddress(parsed.data.address),
    businessContext: readText(parsed.data.businessContext),
    responsibilities: readTextList(parsed.data.responsibilities),
    requirements: readTextList(parsed.data.requirements),
    bonusPoints: readTextList(parsed.data.bonusPoints),
  }
}

function toPreview(source: JobOpportunityImportSource, raw: unknown, warning?: string): JobOpportunityImportPreview {
  const data = parseExtraction(raw)
  const introduction = [data.businessContext, formatSection('工作职责', data.responsibilities)]
    .filter(Boolean)
    .join('\n\n')
  const description = [formatSection('任职要求', data.requirements), formatSection('加分项', data.bonusPoints)]
    .filter(Boolean)
    .join('\n\n')
  const preview: JobOpportunityImportPreview = {
    source,
    sourceUrl: source.url,
    company: data.company,
    jobTitle: data.jobTitle,
    address: data.address,
    introduction,
    description,
    missingRequiredFields: [],
    warning: warning?.trim() || null,
  }

  preview.missingRequiredFields = (['company', 'jobTitle', 'description'] as const).filter((field) => !preview[field])

  const hasJobCoreSignal =
    Boolean(preview.company) ||
    Boolean(preview.jobTitle) ||
    data.responsibilities.length > 0 ||
    data.requirements.length > 0 ||
    data.bonusPoints.length > 0
  const hasAnyExtractedField = hasJobCoreSignal || preview.address.length > 0 || Boolean(data.businessContext)
  const hasJobSignal = source.type === 'text' ? hasAnyExtractedField : hasJobCoreSignal
  if (!hasJobSignal) {
    throw new OpportunityImportError('未识别到可用的岗位信息，请检查输入内容或改为手动填写', 422)
  }

  const hasJobDetail = data.responsibilities.length > 0 || data.requirements.length > 0 || data.bonusPoints.length > 0
  if (source.type === 'url' && !hasJobDetail) {
    throw new OpportunityImportError('页面可以访问，但未识别到工作职责或任职要求，请单独重试或改为粘贴文本', 422)
  }

  return preview
}

function createUrlSource(sourceUrl: string): JobOpportunityImportSource {
  let label = sourceUrl
  try {
    label = new URL(sourceUrl).hostname
  } catch {
    // sourceUrl 已在入口校验；若第三方返回了异常 URL，则退回原文作为来源标签。
  }

  return { type: 'url', label, url: sourceUrl }
}

function toTextImportError(error: unknown) {
  if (error instanceof OpportunityImportError) return error
  if (error instanceof ModelRequestError) {
    if (error.code === 'model_quota_exhausted') return new OpportunityImportError(error.message, 402)
    if (error.code === 'model_authentication_failed' || error.code === 'model_configuration_invalid') {
      return new OpportunityImportError(error.message, 400)
    }
    if (error.code === 'rate_limited') return new OpportunityImportError(error.message, 429)
    if (error.code === 'timeout') return new OpportunityImportError('岗位文本识别超时，请稍后重试', 504)
    return new OpportunityImportError(error.message || '模型暂时无法识别岗位文本，请稍后重试', 502)
  }

  return new OpportunityImportError('模型返回的岗位信息无法解析，请重试或改为手动填写', 422)
}

function toFirecrawlError(status: number, detail: string | undefined) {
  if (status === 401 || status === 403)
    return new OpportunityImportError('Firecrawl Key 无效或无访问权限，请检查服务端配置', 503)
  if (status === 402) return new OpportunityImportError('Firecrawl 额度不足，请检查账户额度后重试', 402)
  if (status === 429) return new OpportunityImportError('网页识别请求过于频繁，请稍后重试', 429)
  if (status >= 500) return new OpportunityImportError('网页抓取服务暂时不可用，请稍后重试', 502)
  return new OpportunityImportError(detail?.trim() || '无法读取该岗位页面，请检查网址后重试', 422)
}

export async function importJobOpportunityFromUrl(
  input: unknown,
  dependencies: ImportDependencies = {},
): Promise<JobOpportunityImportPreview> {
  const parsed = importJobOpportunityFromUrlInputSchema.parse(input)
  const url = normalizePublicUrl(parsed.url)
  const apiKey = dependencies.apiKey?.trim() || getFirecrawlApiKey()
  if (!apiKey) throw new OpportunityImportError('服务端尚未配置 Firecrawl Key', 503)

  const timeoutController = new AbortController()
  const abortFromCaller = () => timeoutController.abort()
  dependencies.signal?.addEventListener('abort', abortFromCaller, { once: true })
  const timeout = setTimeout(() => timeoutController.abort(), firecrawlTimeoutMs)

  try {
    const response = await (dependencies.fetch ?? fetch)(firecrawlApiUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: [
          {
            type: 'json',
            prompt:
              '这是一个招聘岗位页面。只提取页面明确出现的信息，不能根据常识补全或编造。必须按语义而不是段落位置分类：businessContext 是公司、团队、产品、业务线或岗位背景；responsibilities 是入职后需要做什么；requirements 是候选人必须具备什么；bonusPoints 是优先或加分条件。缺失字符串返回空字符串，缺失列表返回空数组。',
            schema: jobImportJsonSchema,
          },
        ],
        onlyMainContent: true,
        timeout: firecrawlTimeoutMs,
      }),
      signal: timeoutController.signal,
    })

    const rawResponse = (await response.json().catch(() => null)) as unknown
    if (!response.ok) {
      const detail =
        typeof rawResponse === 'object' && rawResponse !== null && 'error' in rawResponse
          ? readText((rawResponse as { error?: unknown }).error)
          : undefined
      throw toFirecrawlError(response.status, detail)
    }

    const parsedResponse = firecrawlResponseSchema.safeParse(rawResponse)
    if (!parsedResponse.success || !parsedResponse.data.success || !parsedResponse.data.data?.json) {
      throw new OpportunityImportError('网页抓取成功，但未返回可识别的岗位内容，请改为手动填写', 422)
    }

    const sourceUrl = parsedResponse.data.data.metadata?.sourceURL || parsedResponse.data.data.metadata?.url || url
    return toPreview(createUrlSource(sourceUrl), parsedResponse.data.data.json, parsedResponse.data.data.warning)
  } catch (error) {
    if (error instanceof OpportunityImportError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      if (dependencies.signal?.aborted) throw new OpportunityImportError('网页识别已取消', 499)
      throw new OpportunityImportError('网页识别超时，请稍后重试', 504)
    }
    throw new OpportunityImportError('暂时无法连接网页抓取服务，请稍后重试', 502)
  } finally {
    clearTimeout(timeout)
    dependencies.signal?.removeEventListener('abort', abortFromCaller)
  }
}

/**
 * 批量导入只并发处理最多 5 条网址，每条结果独立返回。
 * 一条网址失败不会抹掉其他已成功的预览，也不会在这一阶段写入机会表。
 */
export async function importJobOpportunitiesFromUrls(
  input: unknown,
  dependencies: ImportDependencies = {},
): Promise<{ items: JobOpportunityBatchImportItem[] }> {
  const parsed = importJobOpportunitiesFromUrlsInputSchema.parse(input)

  const items: JobOpportunityBatchImportItem[] = new Array(parsed.urls.length)
  const urlsByHostname = new Map<string, Array<{ index: number; url: string }>>()

  for (const [index, url] of parsed.urls.entries()) {
    const hostname = new URL(url).hostname.toLowerCase()
    const group = urlsByHostname.get(hostname) ?? []
    group.push({ index, url })
    urlsByHostname.set(hostname, group)
  }

  await Promise.all(
    [...urlsByHostname.values()].map(async (group) => {
      // 同站点串行，避免短时间并发触发抓取限流；不同站点仍然可以并发。
      for (const { index, url } of group) {
        try {
          const preview = await importJobOpportunityFromUrl({ url }, dependencies)
          items[index] = { url, status: 'ready', preview }
        } catch (error) {
          const importError =
            error instanceof OpportunityImportError
              ? error
              : new OpportunityImportError('网页识别失败，请稍后重试', 502)
          items[index] = {
            url,
            status: 'failed',
            error: importError.message,
            statusCode: importError.statusCode,
          }
        }
      }
    }),
  )

  return { items }
}

export async function importJobOpportunityFromText(
  input: unknown,
  dependencies: TextImportDependencies = {},
): Promise<JobOpportunityImportPreview> {
  const parsed = importJobOpportunityFromTextInputSchema.parse(input)
  const requestCompletion = dependencies.requestCompletion ?? requestModelCompletion
  const operationKey = `opportunity-import:text:${crypto.randomUUID()}`
  const abortFromCaller = () => cancelModelRequest(operationKey)
  dependencies.signal?.addEventListener('abort', abortFromCaller, { once: true })

  try {
    const completion = await requestCompletion(
      operationKey,
      parsed.modelConnection,
      [
        '你是招聘岗位信息提取器。',
        '输入是一份岗位原文，只能提取原文明确出现的信息，不能使用常识补全或编造。',
        '必须按语义区分：businessContext 是公司/团队/产品/业务背景；responsibilities 是入职后做什么；requirements 是候选人必须具备什么；bonusPoints 是优先或加分条件。',
        '不能仅按段落顺序分类。输出必须是一个 JSON 对象，不要输出解释、Markdown 或额外字段。',
        '字段固定为 company、jobTitle、address、businessContext、responsibilities、requirements、bonusPoints。',
        '原文缺少公司、岗位名称或工作地点时不要拒绝提取；保留对应空值，并继续返回其余能够确认的字段。',
        '保持结果简洁，不要重复粘贴整段原文。',
        '缺失字符串返回空字符串，缺失列表返回空数组。',
      ].join('\n'),
      JSON.stringify({ sourceText: parsed.text }),
      { temperature: 0, maxTokens: 2_000 },
    )

    const raw = parseModelOutputJson(completion.rawOutput)
    return toPreview({ type: 'text', label: '粘贴文本', url: null }, raw)
  } catch (error) {
    throw toTextImportError(error)
  } finally {
    dependencies.signal?.removeEventListener('abort', abortFromCaller)
  }
}
