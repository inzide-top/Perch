import { appAuthMode } from './auth/auth-mode'
import { getAuthAccessToken, invalidateAuthSession, refreshAuthAccessToken } from './auth/supabase-client'
import { getUserErrorMessage, isAbortError } from './error-presentation'

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() ?? ''
const isLoopbackApiUrl = /^(?:https?:\/\/)?(?:localhost|127(?:\.\d{1,3}){3})(?::\d+)?(?:\/|$)/i.test(
  configuredApiBaseUrl,
)

// 生产构建禁止静默回退到本机地址，否则线上会把“服务未配置”伪装成网络故障。
export const apiBaseUrl =
  configuredApiBaseUrl && (!import.meta.env.PROD || !isLoopbackApiUrl)
    ? configuredApiBaseUrl.replace(/\/$/, '')
    : import.meta.env.DEV
      ? 'http://127.0.0.1:8787/api'
      : ''

export function toApiUrl(path: string) {
  if (!apiBaseUrl) {
    throw new ApiRequestError('线上服务地址尚未配置', 0, { code: 'api_base_url_missing' }, 'api_base_url_missing')
  }
  return `${apiBaseUrl}${path}`
}

export type RequestOptions = Omit<RequestInit, 'body' | 'method'>

export class ApiRequestError extends Error {
  readonly status: number
  readonly data: unknown
  readonly code: string | null

  constructor(message: string, status: number, data: unknown = null, code?: string) {
    const dataCode =
      data && typeof data === 'object' && 'code' in data && typeof data.code === 'string' ? data.code : null
    const resolvedCode = code ?? dataCode ?? null
    super(getUserErrorMessage({ message, status, code: resolvedCode }, message || '请求失败，请稍后重试。'))
    this.name = 'ApiRequestError'
    this.status = status
    this.data = data
    this.code = resolvedCode
  }
}

function wrapNetworkError(error: unknown, code = 'network_error') {
  if (isAbortError(error)) throw error
  return new ApiRequestError('', 0, error, code)
}

async function fetchResponse(url: string, options: RequestInit) {
  try {
    return await fetch(url, options)
  } catch (error) {
    throw wrapNetworkError(error)
  }
}

async function fetchWithAuthentication(path: string, options: RequestInit, allowRefresh: boolean): Promise<Response> {
  const headers = new Headers(options.headers)

  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData
  if (options.body !== undefined && options.body !== null && !isFormData && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }

  let accessToken: string | null
  try {
    accessToken = await getAuthAccessToken()
  } catch (error) {
    throw wrapNetworkError(error, 'auth_session_unavailable')
  }
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`)

  const response = await fetchResponse(toApiUrl(path), {
    ...options,
    headers,
  })

  if (response.status !== 401 || appAuthMode !== 'supabase' || !allowRefresh) return response

  const refreshedToken = await refreshAuthAccessToken()
  if (!refreshedToken) return response

  headers.set('authorization', `Bearer ${refreshedToken}`)
  const retriedResponse = await fetchResponse(toApiUrl(path), {
    ...options,
    headers,
  })
  if (retriedResponse.status === 401) await invalidateAuthSession()
  return retriedResponse
}

async function coreRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetchWithAuthentication(path, options, true)

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { message?: string } | null
    throw new ApiRequestError(errorBody?.message ?? `Request failed: ${response.status}`, response.status, errorBody)
  }

  if (response.status === 204) return undefined as T

  return response.json() as Promise<T>
}

function withJsonBody(method: 'POST' | 'PATCH' | 'PUT', payload: unknown, options: RequestOptions = {}): RequestInit {
  return {
    ...options,
    method,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  }
}

/** 统一 REST 请求入口：默认把普通对象作为 JSON 请求体发送。 */
export const request = {
  get<T>(path: string, options: RequestOptions = {}) {
    return coreRequest<T>(path, { cache: 'no-store', ...options, method: 'GET' })
  },

  post<T>(path: string, payload?: unknown, options: RequestOptions = {}) {
    return coreRequest<T>(path, withJsonBody('POST', payload, options))
  },

  postForm<T>(path: string, payload: FormData, options: RequestOptions = {}) {
    return coreRequest<T>(path, { ...options, method: 'POST', body: payload })
  },

  patch<T>(path: string, payload?: unknown, options: RequestOptions = {}) {
    return coreRequest<T>(path, withJsonBody('PATCH', payload, options))
  },

  put<T>(path: string, payload?: unknown, options: RequestOptions = {}) {
    return coreRequest<T>(path, withJsonBody('PUT', payload, options))
  },

  delete<T>(path: string, options: RequestOptions = {}) {
    return coreRequest<T>(path, { ...options, method: 'DELETE' })
  },
}
