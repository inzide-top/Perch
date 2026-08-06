import type { ModelConnection } from '../../schemas/model.schema'
import type { AgentRunError, AgentTokenUsage } from './types'

export type { ModelConnection } from '../../schemas/model.schema'

/** Shared timeout for non-streaming model tasks. Interactive chat will use its own stream lifecycle. */
export const modelRequestTimeoutMs = 300_000
export const modelRequestTimeoutGraceMs = 15_000

export type ModelCompletion = {
  rawOutput: string
  tokenUsage: AgentTokenUsage | null
}

export type ModelCompletionOptions = {
  temperature?: number
  maxTokens?: number
  seed?: number
}

const cancelledAnalysisOpportunityIds = new Set<string>()
const activeModelRequestControllers = new Map<string, AbortController>()
const cancelledModelRequestKeys = new Set<string>()
const cancelledModelRequestTimers = new Map<string, ReturnType<typeof setTimeout>>()

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
  cancelModelRequest(opportunityId)
}

export function isJobAnalysisCancelled(opportunityId: string) {
  return cancelledAnalysisOpportunityIds.has(opportunityId)
}

export function cancelModelRequest(operationKey: string) {
  cancelledModelRequestKeys.add(operationKey)
  activeModelRequestControllers.get(operationKey)?.abort()
  const existingTimer = cancelledModelRequestTimers.get(operationKey)
  if (existingTimer) clearTimeout(existingTimer)
  cancelledModelRequestTimers.set(
    operationKey,
    setTimeout(() => clearModelRequestCancellation(operationKey), 60_000),
  )
}

export function isModelRequestCancelled(operationKey: string) {
  return cancelledModelRequestKeys.has(operationKey)
}

export function clearModelRequestCancellation(operationKey: string) {
  cancelledModelRequestKeys.delete(operationKey)
  const timer = cancelledModelRequestTimers.get(operationKey)
  if (timer) clearTimeout(timer)
  cancelledModelRequestTimers.delete(operationKey)
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

export function getModelErrorDetails(status: number, body: string) {
  const normalizedBody = body.toLowerCase()
  const quotaExhausted = [
    'allocationquota',
    'free quota exhausted',
    'insufficient_quota',
    'insufficient quota',
    'quota_exceeded',
    'quota exceeded',
    'credit balance',
    'billing balance',
  ].some((marker) => normalizedBody.includes(marker))

  if (status === 402 || quotaExhausted) {
    return {
      code: 'model_quota_exhausted' as const,
      retryable: false,
      message: '当前模型额度已用完，请检查服务商余额或消费额度后重试',
    }
  }

  if (status === 401 || status === 403) {
    return {
      code: 'model_authentication_failed' as const,
      retryable: false,
      message: '模型鉴权失败，请检查 API Key 是否正确或仍然有效',
    }
  }

  if (status === 429) {
    return { code: 'rate_limited' as const, retryable: true, message: '模型服务触发限流，请稍后重试' }
  }

  const configurationInvalid =
    status === 404 ||
    ((status === 400 || status === 422) &&
      ['model', 'endpoint', 'base url', 'not found', 'does not exist', 'unsupported'].some((marker) =>
        normalizedBody.includes(marker),
      ))

  if (configurationInvalid) {
    return {
      code: 'model_configuration_invalid' as const,
      retryable: false,
      message: '模型配置不可用，请检查 Base URL、模型名称和接口兼容性',
    }
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
  operationKey: string,
  modelConnection: ModelConnection,
  systemPrompt: string,
  userPrompt: string,
  options: ModelCompletionOptions = {},
): Promise<ModelCompletion> {
  if (isModelRequestCancelled(operationKey)) {
    throw new ModelRequestError('模型任务已由用户取消', 'cancelled', false)
  }

  const controller = new AbortController()
  let didTimeout = false
  activeModelRequestControllers.set(operationKey, controller)
  const timeout = setTimeout(() => {
    didTimeout = true
    controller.abort()
  }, modelRequestTimeoutMs)

  try {
    const requestBody: Record<string, unknown> = {
      model: modelConnection.modelName,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 6000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }
    if (options.seed !== undefined) requestBody.seed = options.seed

    const response = await fetch(normalizeBaseUrl(modelConnection.baseUrl), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${modelConnection.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestBody),
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
      if (isModelRequestCancelled(operationKey)) {
        throw new ModelRequestError('模型任务已由用户取消', 'cancelled', false)
      }

      if (!didTimeout) {
        throw new ModelRequestError('模型请求已中断', 'model_request_failed', true)
      }

      throw new ModelRequestError('模型请求超时', 'timeout', true)
    }

    throw new ModelRequestError(
      error instanceof Error ? error.message : '模型请求发生未知错误',
      'model_request_failed',
      true,
    )
  } finally {
    clearTimeout(timeout)
    if (activeModelRequestControllers.get(operationKey) === controller) {
      activeModelRequestControllers.delete(operationKey)
    }
  }
}
