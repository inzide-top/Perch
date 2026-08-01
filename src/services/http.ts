export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8787/api'

export function toApiUrl(path: string) {
  return `${apiBaseUrl}${path}`
}

type RequestOptions = Omit<RequestInit, 'body' | 'method'>

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

async function coreRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)

  if (options.body !== undefined && options.body !== null && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }

  const response = await fetch(toApiUrl(path), {
    ...options,
    headers,
  })

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
    return coreRequest<T>(path, { ...options, method: 'GET' })
  },

  post<T>(path: string, payload?: unknown, options: RequestOptions = {}) {
    return coreRequest<T>(path, withJsonBody('POST', payload, options))
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
