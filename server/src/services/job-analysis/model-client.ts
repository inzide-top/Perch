import type { AgentRunError, AgentTokenUsage } from '@/types/opportunity'
import type { StartJobAnalysisInput } from '../../schemas/job-analysis.schema'

export const modelRequestTimeoutMs = 300_000
export const modelRequestTimeoutGraceMs = 15_000

export type ModelConnection = StartJobAnalysisInput['modelConnection']

export type ModelCompletion = {
  rawOutput: string
  tokenUsage: AgentTokenUsage | null
}

const cancelledAnalysisOpportunityIds = new Set<string>()
const activeModelRequestControllers = new Map<string, AbortController>()

export class ModelRequestError extends Error {
  constructor(
    message: string,
    readonly code: AgentRunError['code'],
    readonly retryable: boolean,
    readonly rawOutput: string | null = null,
    readonly tokenUsage: AgentTokenUsage | null = null,
  ) {
    super(message)
    this.name = 'ModelRequestError'
  }
}

export function cancelJobAnalysisForOpportunity(opportunityId: string) {
  cancelledAnalysisOpportunityIds.add(opportunityId)
  activeModelRequestControllers.get(opportunityId)?.abort()
}

export function isJobAnalysisCancelled(opportunityId: string) {
  return cancelledAnalysisOpportunityIds.has(opportunityId)
}

export function normalizeBaseUrl(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/, '')

  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`
}

function toTokenUsage(value: unknown): AgentTokenUsage | null {
  if (!value || typeof value !== 'object') return null

  const usage = value as { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown }
  const inputTokens = Number(usage.prompt_tokens)
  const outputTokens = Number(usage.completion_tokens)
  const totalTokens = Number(usage.total_tokens)

  if (![inputTokens, outputTokens, totalTokens].every(Number.isFinite)) return null

  return { inputTokens, outputTokens, totalTokens }
}

function getModelErrorDetails(status: number, body: string) {
  if (status === 429) {
    return { code: 'rate_limited' as const, retryable: true, message: '模型服务触发限流，请稍后重试' }
  }

  if (status >= 500) {
    return { code: 'model_request_failed' as const, retryable: true, message: '模型服务暂时不可用' }
  }

  return {
    code: 'model_request_failed' as const,
    retryable: false,
    message: body || `模型服务请求失败（HTTP ${status}）`,
  }
}

export async function requestModelCompletion(
  opportunityId: string,
  modelConnection: ModelConnection,
  systemPrompt: string,
  userPrompt: string,
): Promise<ModelCompletion> {
  const controller = new AbortController()
  activeModelRequestControllers.set(opportunityId, controller)
  const timeout = setTimeout(() => controller.abort(), modelRequestTimeoutMs)

  try {
    const response = await fetch(normalizeBaseUrl(modelConnection.baseUrl), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${modelConnection.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: modelConnection.modelName,
        temperature: 0.2,
        max_tokens: 6000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    })

    const rawResponse = await response.text()
    if (!response.ok) {
      const details = getModelErrorDetails(response.status, rawResponse)
      throw new ModelRequestError(details.message, details.code, details.retryable, rawResponse)
    }

    let payload: unknown
    try {
      payload = JSON.parse(rawResponse)
    } catch {
      throw new ModelRequestError('模型服务返回了非 JSON 响应', 'model_request_failed', true, rawResponse)
    }

    const completion = payload as {
      choices?: Array<{ message?: { content?: unknown } }>
      usage?: unknown
    }
    const rawOutput = completion.choices?.[0]?.message?.content

    if (typeof rawOutput !== 'string' || rawOutput.trim() === '') {
      throw new ModelRequestError(
        '模型服务未返回可用内容',
        'model_request_failed',
        true,
        rawResponse,
        toTokenUsage(completion.usage),
      )
    }

    return {
      rawOutput: rawOutput.trim(),
      tokenUsage: toTokenUsage(completion.usage),
    }
  } catch (error) {
    if (error instanceof ModelRequestError) throw error

    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ModelRequestError('模型请求超时', 'timeout', true)
    }

    throw new ModelRequestError(
      error instanceof Error ? error.message : '模型请求发生未知错误',
      'model_request_failed',
      true,
    )
  } finally {
    clearTimeout(timeout)
    if (activeModelRequestControllers.get(opportunityId) === controller) {
      activeModelRequestControllers.delete(opportunityId)
    }
  }
}
