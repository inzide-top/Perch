import { isIP } from 'node:net'

/** Explicit opt-in bypasses destination restrictions, independent of NODE_ENV. */
export function validateModelRequestUrl(
  value: string,
  allowedOrigins = process.env.MODEL_ALLOWED_ORIGINS,
  unrestrictedLocal = process.env.MODEL_ALLOW_UNRESTRICTED_LOCAL,
): URL {
  if (unrestrictedLocal?.trim() === 'true') {
    let target: URL
    try {
      target = new URL(value)
    } catch {
      throw new Error('模型服务地址格式无效')
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      throw new Error('模型服务地址必须使用 HTTP 或 HTTPS')
    }
    return target
  }

  if (!allowedOrigins?.trim()) {
    throw new Error('服务器尚未配置模型服务白名单，请联系管理员配置 MODEL_ALLOWED_ORIGINS')
  }

  function parseUrl(input: string): URL {
    let url: URL
    try {
      url = new URL(input)
    } catch {
      throw new Error('模型服务地址必须是有效的 HTTPS 地址')
    }
    const hostname = url.hostname.toLowerCase()
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      isIP(hostname.replace(/^\[|\]$/g, '')) !== 0 ||
      !hostname.includes('.') ||
      hostname.endsWith('.') ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.home.arpa') ||
      hostname.includes('*')
    ) {
      throw new Error('模型服务仅支持不含凭据、查询参数的 HTTPS 服务域名，不支持本机或 IP 地址')
    }
    return url
  }

  const entries = allowedOrigins.split(',').map((entry) => entry.trim())
  const origins = entries.map((entry) => {
    try {
      const url = parseUrl(entry)
      if (url.pathname !== '/') throw new Error('origin only')
      return url.origin
    } catch {
      throw new Error('服务器模型白名单配置无效：请填写逗号分隔的 HTTPS 来源，不含路径、查询参数或通配符')
    }
  })
  const target = parseUrl(value)
  if (!origins.includes(target.origin)) {
    throw new Error('该模型服务暂不支持，请使用管理员允许的模型服务地址')
  }
  return target
}
