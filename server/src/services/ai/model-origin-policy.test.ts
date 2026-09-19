import assert from 'node:assert/strict'
import test, { beforeEach, afterEach } from 'node:test'
import { validateModelRequestUrl } from './model-origin-policy'
import { ModelRequestError, requestAllowedModel, requestModelCompletion } from './model-client'
import { OpenAICompatibleAdapter } from '../chat/openai-compatible-adapter'

const allowed = 'https://api.example.com,https://relay.example.com:8443'

test('允许精确来源，保留兼容接口路径，并规范化默认 HTTPS 端口', () => {
  assert.equal(
    validateModelRequestUrl('https://API.example.com:443/v1/chat/completions', allowed).origin,
    'https://api.example.com',
  )
  assert.equal(
    validateModelRequestUrl('https://relay.example.com:8443/custom/chat/completions', allowed).pathname,
    '/custom/chat/completions',
  )
})

for (const value of [
  'https://api.example.com.evil.com/v1',
  'https://sub.api.example.com/v1',
  'https://api.example.com:8443/v1',
  'http://api.example.com/v1',
  'https://127.0.0.1/v1',
  'https://2130706433/v1',
  'https://[::1]/v1',
  'https://[::ffff:127.0.0.1]/v1',
  'https://10.0.0.1/v1',
  'https://169.254.169.254/v1',
  'https://localhost/v1',
  'https://host.local/v1',
  'https://user:secret@api.example.com/v1',
  'https://api.example.com/v1?next=internal',
  'https://api.example.com/v1#fragment',
  'https://api.example.com./v1',
  'not a url',
]) {
  test(`拒绝未经允许或不安全的模型地址：${value}`, () => {
    assert.throws(() => validateModelRequestUrl(value, allowed))
  })
}

for (const value of [
  '',
  ' ',
  'https://api.example.com/v1',
  'https://*.example.com',
  'https://api.example.com,',
  'https://api.example.com,invalid',
  'https://127.0.0.1',
  'http://api.example.com',
]) {
  test(`白名单缺失或配置错误时拒绝调用：${JSON.stringify(value)}`, () => {
    assert.throws(() => validateModelRequestUrl('https://api.example.com/v1', value))
  })
}

test('两条实际模型调用路径均在发送请求前拒绝地址，且不可重试', async () => {
  const previous = process.env.MODEL_ALLOWED_ORIGINS
  const originalFetch = globalThis.fetch
  process.env.MODEL_ALLOWED_ORIGINS = allowed
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    throw new Error('must not fetch')
  }
  const connection = { baseUrl: 'https://unapproved.example.com/v1', modelName: 'demo', apiKey: 'secret-test' }
  const check = (error: unknown) =>
    error instanceof ModelRequestError &&
    error.code === 'model_configuration_invalid' &&
    !error.retryable &&
    !error.message.includes('secret-test')
  try {
    await assert.rejects(requestModelCompletion('policy-test', connection, 'system', 'user'), check)
    await assert.rejects(async () => {
      for await (const event of new OpenAICompatibleAdapter().stream({
        modelConnection: connection,
        messages: [],
        tools: [],
        signal: new AbortController().signal,
      }))
        void event
    }, check)
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = originalFetch
    if (previous === undefined) delete process.env.MODEL_ALLOWED_ORIGINS
    else process.env.MODEL_ALLOWED_ORIGINS = previous
  }
})

test('允许来源的 JSON 请求保留鉴权与信号，任何重定向均不进行第二次请求', async () => {
  const previous = process.env.MODEL_ALLOWED_ORIGINS
  const originalFetch = globalThis.fetch
  process.env.MODEL_ALLOWED_ORIGINS = allowed
  const requests: Array<{ url: string; init?: RequestInit }> = []
  let status = 200
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init })
    if (status !== 200) return new Response('', { status, headers: { location: 'http://127.0.0.1/private' } })
    return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] })
  }
  try {
    const result = await requestModelCompletion(
      'policy-success',
      { baseUrl: 'https://api.example.com/v1', modelName: 'demo', apiKey: 'test-key' },
      'system',
      'user',
    )
    assert.equal(result.rawOutput, '{"ok":true}')
    assert.equal(requests[0]?.url, 'https://api.example.com/v1/chat/completions')
    assert.equal(new Headers(requests[0]?.init?.headers).get('authorization'), 'Bearer test-key')
    assert.ok(requests[0]?.init?.signal instanceof AbortSignal)
    for (const redirectStatus of [301, 302, 303, 307, 308]) {
      status = redirectStatus
      const before = requests.length
      await assert.rejects(
        requestAllowedModel('https://api.example.com/v1', { redirect: 'follow' }),
        (error: unknown) => error instanceof ModelRequestError && !error.retryable,
      )
      assert.equal(requests.length, before + 1)
    }
    assert.ok(requests.every((request) => request.init?.redirect === 'manual'))
  } finally {
    globalThis.fetch = originalFetch
    if (previous === undefined) delete process.env.MODEL_ALLOWED_ORIGINS
    else process.env.MODEL_ALLOWED_ORIGINS = previous
  }
})

const previousUnrestrictedLocal = process.env.MODEL_ALLOW_UNRESTRICTED_LOCAL
beforeEach(() => {
  delete process.env.MODEL_ALLOW_UNRESTRICTED_LOCAL
})
afterEach(() => {
  if (previousUnrestrictedLocal === undefined) delete process.env.MODEL_ALLOW_UNRESTRICTED_LOCAL
  else process.env.MODEL_ALLOW_UNRESTRICTED_LOCAL = previousUnrestrictedLocal
})

for (const target of [
  'http://localhost:11434/v1',
  'http://127.0.0.1:8080/v1',
  'http://[::1]:11434/v1',
  'http://10.0.0.2:3000/v1',
  'https://custom.example.org:8443/v1',
]) {
  test(`显式 true 允许自定义目标且忽略错误白名单：${target}`, () => {
    assert.equal(validateModelRequestUrl(target, 'not-an-origin', 'true').href, target)
    assert.equal(validateModelRequestUrl(target, '', ' true ').href, target)
  })
}
for (const flag of ['', 'false', 'TRUE', '1', 'typo']) {
  test(`非 true 值保持白名单模式：${JSON.stringify(flag)}`, () => {
    assert.throws(() => validateModelRequestUrl('http://localhost:11434/v1', allowed, flag))
    assert.throws(() => validateModelRequestUrl('https://api.example.com/v1', '', flag))
  })
}
test('无限制模式仍要求有效 HTTP/HTTPS 地址', () => {
  for (const target of ['invalid', 'file:///etc/hosts', 'ftp://example.com']) {
    assert.throws(() => validateModelRequestUrl(target, '', 'true'))
  }
})
test('环境开关覆盖生产环境，两条调用路径均可使用本地模型', async () => {
  const oldNodeEnv = process.env.NODE_ENV
  const oldFetch = globalThis.fetch
  const oldAllowed = process.env.MODEL_ALLOWED_ORIGINS
  process.env.NODE_ENV = 'production'
  process.env.MODEL_ALLOW_UNRESTRICTED_LOCAL = 'true'
  delete process.env.MODEL_ALLOWED_ORIGINS
  let calls = 0
  globalThis.fetch = async (url, init) => {
    calls++
    assert.equal(String(url), 'http://localhost:11434/v1/chat/completions')
    assert.equal(init?.redirect, 'manual')
    if (JSON.parse(String(init?.body)).stream) return new Response('data: [DONE]\n\n')
    return Response.json({ choices: [{ message: { content: 'ok' } }] })
  }
  try {
    const modelConnection = { baseUrl: 'http://localhost:11434/v1', modelName: 'demo', apiKey: 'test' }
    assert.equal((await requestModelCompletion('local-mode', modelConnection, 'system', 'user')).rawOutput, 'ok')
    for await (const event of new OpenAICompatibleAdapter().stream({
      modelConnection,
      messages: [],
      tools: [],
      signal: new AbortController().signal,
    }))
      void event
    assert.equal(calls, 2)
  } finally {
    globalThis.fetch = oldFetch
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = oldNodeEnv
    if (oldAllowed === undefined) delete process.env.MODEL_ALLOWED_ORIGINS
    else process.env.MODEL_ALLOWED_ORIGINS = oldAllowed
  }
})
