import { AsyncLocalStorage } from 'node:async_hooks'

export type RequestMetrics = {
  startedAt: number
  responseBytes: number
  dbQueryCount: number
  dbDurationMs: number
}

const requestMetricsStorage = new AsyncLocalStorage<RequestMetrics>()

export function createRequestMetrics(): RequestMetrics {
  return {
    startedAt: performance.now(),
    responseBytes: 0,
    dbQueryCount: 0,
    dbDurationMs: 0,
  }
}

export function enterRequestMetrics(metrics: RequestMetrics) {
  requestMetricsStorage.enterWith(metrics)
}

export function getRequestMetrics() {
  return requestMetricsStorage.getStore() ?? null
}

/** 对关键读路径记录数据库耗时；查询次数由 Drizzle logger 统一计数。 */
export async function measureDb<T>(operation: () => Promise<T>): Promise<T> {
  const metrics = getRequestMetrics()
  const startedAt = performance.now()

  try {
    return await operation()
  } finally {
    if (metrics) metrics.dbDurationMs += performance.now() - startedAt
  }
}

export const requestMetricsLogger = {
  logQuery() {
    const metrics = getRequestMetrics()
    if (metrics) metrics.dbQueryCount += 1
  },
}

export function getPayloadByteLength(payload: unknown) {
  if (typeof payload === 'string') return Buffer.byteLength(payload)
  if (Buffer.isBuffer(payload)) return payload.byteLength
  if (payload === undefined || payload === null) return 0

  try {
    return Buffer.byteLength(JSON.stringify(payload))
  } catch {
    return 0
  }
}
