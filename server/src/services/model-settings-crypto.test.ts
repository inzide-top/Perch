import assert from 'node:assert/strict'
import test from 'node:test'
import { encryptModelSettings, decryptModelSettings } from './model-settings-crypto'

test('模型配置加密往返、随机 nonce、账号绑定、防篡改和密钥校验', () => {
  const original = process.env.MODEL_CONFIG_ENCRYPTION_KEY
  try {
    process.env.MODEL_CONFIG_ENCRYPTION_KEY = 'ab'.repeat(32)
    const settings = {
      llm: { apiKey: 'test-private-api-key', modelName: 'test-model', baseUrl: 'https://example.com' },
      savedLlmConnections: [],
    }
    const encrypted = encryptModelSettings(settings, 'user-a')
    assert.deepEqual(decryptModelSettings(encrypted, 'user-a'), settings)
    assert.ok(!encrypted.includes(settings.llm.apiKey))
    assert.notEqual(encryptModelSettings(settings, 'user-a'), encrypted)
    assert.throws(() => decryptModelSettings(encrypted, 'user-b'))
    const parts = encrypted.split('.')
    const bytes = Buffer.from(parts[3]!, 'base64')
    bytes[0] = bytes[0]! ^ 1
    parts[3] = bytes.toString('base64')
    assert.throws(() => decryptModelSettings(parts.join('.'), 'user-a'))
    process.env.MODEL_CONFIG_ENCRYPTION_KEY = 'cd'.repeat(32)
    assert.throws(() => decryptModelSettings(encrypted, 'user-a'))
    delete process.env.MODEL_CONFIG_ENCRYPTION_KEY
    assert.throws(() => encryptModelSettings(settings, 'user-a'), /MODEL_CONFIG_ENCRYPTION_KEY/)
    process.env.MODEL_CONFIG_ENCRYPTION_KEY = 'short-key'
    assert.throws(() => encryptModelSettings(settings, 'user-a'), /MODEL_CONFIG_ENCRYPTION_KEY/)
  } finally {
    if (original === undefined) delete process.env.MODEL_CONFIG_ENCRYPTION_KEY
    else process.env.MODEL_CONFIG_ENCRYPTION_KEY = original
  }
})
