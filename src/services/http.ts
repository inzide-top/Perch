import { appAuthMode } from './auth/auth-mode'
import { getAuthAccessToken, invalidateAuthSession, refreshAuthAccessToken } from './auth/supabase-client'

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8787/api'

export function toApiUrl(path: string) {
  return `${apiBaseUrl}${path}`
}

export type RequestOptions = Omit<RequestInit, 'body' | 'method'>

export class ApiRequestError extends Error {
  readonly status: number
  readonly data: unknown

  constructor(message: string, status: number, data: unknown = null) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.data = data
  }
}

async function fetchWithAuthentication(path: string, options: RequestInit, allowRefresh: boolean): Promise<Response> {
  const headers = new Headers(options.headers)

  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData
  if (options.body !== undefined && options.body !== null && !isFormData && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }

  const accessToken = await getAuthAccessToken()
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`)

  const response = await fetch(toApiUrl(path), {
    ...options,
    headers,
  })

  if (response.status !== 401 || appAuthMode !== 'supabase' || !allowRefresh) return response

  const refreshedToken = await refreshAuthAccessToken()
  if (!refreshedToken) return response

  headers.set('authorization', `Bearer ${refreshedToken}`)
  const retriedResponse = await fetch(toApiUrl(path), {
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
