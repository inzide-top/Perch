export type UserErrorContext = 'auth' | 'load' | 'save' | 'delete' | 'submit' | 'generic'

type ErrorShape = {
  message?: unknown
  name?: unknown
  code?: unknown
  status?: unknown
}

function readError(error: unknown): ErrorShape {
  if (!error || typeof error !== 'object') return {}
  return error as ErrorShape
}

function readMessage(error: unknown) {
  if (typeof error === 'string') return error.trim()
  const message = readError(error).message
  return typeof message === 'string' ? message.trim() : ''
}

function readStatus(error: unknown) {
  const status = readError(error).status
  return typeof status === 'number' ? status : null
}

function readCode(error: unknown) {
  const code = readError(error).code
  return typeof code === 'string' ? code : ''
}

export function isAbortError(error: unknown) {
  return readError(error).name === 'AbortError'
}

export function isNetworkError(error: unknown) {
  const message = readMessage(error)
  return (
    readCode(error) === 'network_error' ||
    /failed to fetch|fetch failed|network request failed|networkerror|load failed|connection (?:refused|reset|timed out)/i.test(
      message,
    )
  )
}

function isTechnicalMessage(message: string) {
  if (!message) return true
  if (isNetworkError({ message })) return true
  return /^(?:error|request failed|internal server error|bad gateway|service unavailable|gateway timeout)(?:\s*:\s*\d+)?$/i.test(
    message,
  )
}

function statusMessage(status: number, context: UserErrorContext) {
  if (status === 401)
    return context === 'auth' ? '邮箱或密码不正确，或登录状态已失效。' : '登录状态已失效，请重新登录。'
  if (status === 403) return '当前账号没有执行此操作的权限。'
  if (status === 404) return '请求的数据不存在，可能已被删除。'
  if (status === 408 || status === 504) return '请求超时了，请稍后重试。'
  if (status === 409) return '数据已经发生变化，请刷新页面后重试。'
  if (status === 413) return '提交内容太大，请精简后再试。'
  if (status === 429) return '操作太频繁，请稍后再试。'
  if (status >= 500) return '服务暂时不可用，请稍后重试。'
  return ''
}

/**
 * 将网络层、鉴权层和服务端错误统一转换为可以直接展示给用户的中文文案。
 * 只有明确的业务错误会保留服务端原文；浏览器原生英文错误不会泄露到 UI。
 */
export function getUserErrorMessage(
  error: unknown,
  fallback = '操作失败，请稍后重试。',
  context: UserErrorContext = 'generic',
) {
  const code = readCode(error)
  const status = readStatus(error)
  const message = readMessage(error)

  if (code === 'api_base_url_missing') return '线上服务地址尚未配置，请联系管理员。'
  if (code === 'auth_session_unavailable') return '登录状态暂时无法确认，请刷新页面后重试。'
  if (isAbortError(error)) return '请求已取消。'
  if (isNetworkError(error)) return '网络连接暂时不可用，请检查网络后重试。'

  if (status !== null) {
    const byStatus = statusMessage(status, context)
    if (byStatus) {
      // 业务错误通常已经是产品文案，优先保留它；技术性文案使用统一提示。
      if (message && !isTechnicalMessage(message)) return message
      return byStatus
    }
  }

  if (isTechnicalMessage(message)) return fallback
  return message || fallback
}
