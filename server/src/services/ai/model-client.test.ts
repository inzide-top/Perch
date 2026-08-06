import assert from 'node:assert/strict'
import test from 'node:test'
import { getModelErrorDetails } from './model-client'

test('额度耗尽错误不会继续自动重试', () => {
  const result = getModelErrorDetails(
    429,
    JSON.stringify({ error: { code: 'AllocationQuota.FreeTierOnly', message: 'Free quota exhausted.' } }),
  )

  assert.equal(result.code, 'model_quota_exhausted')
  assert.equal(result.retryable, false)
})

test('鉴权失败会提示检查 API Key', () => {
  const result = getModelErrorDetails(401, JSON.stringify({ error: { message: 'Invalid API key' } }))

  assert.equal(result.code, 'model_authentication_failed')
  assert.equal(result.retryable, false)
})

test('模型名称或端点错误会归类为配置问题', () => {
  const result = getModelErrorDetails(404, JSON.stringify({ error: { message: 'Model does not exist' } }))

  assert.equal(result.code, 'model_configuration_invalid')
  assert.equal(result.retryable, false)
})

test('无法识别响应正文的 404 仍按模型端点配置错误处理', () => {
  const result = getModelErrorDetails(404, '<html>Cannot POST /v1/chat/completions</html>')

  assert.equal(result.code, 'model_configuration_invalid')
  assert.equal(result.retryable, false)
})

test('普通 429 仍作为可恢复的限流错误', () => {
  const result = getModelErrorDetails(429, JSON.stringify({ error: { message: 'Too many requests' } }))

  assert.equal(result.code, 'rate_limited')
  assert.equal(result.retryable, true)
})
