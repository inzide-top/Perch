import assert from 'node:assert/strict'
import test from 'node:test'
import Fastify from 'fastify'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { runWithCurrentUser } from '../context/current-user'

test('模型配置接口隔离账号、持久恢复、迁移不覆盖及保存失败', async (t) => {
  const previousUrl = process.env.DATABASE_URL
  const previousKey = process.env.MODEL_CONFIG_ENCRYPTION_KEY
  process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/test'
  process.env.MODEL_CONFIG_ENCRYPTION_KEY = 'ab'.repeat(32)
  const { db, closeDatabase } = await import('../db/client')
  const { modelSettingsRoute } = await import('./model-settings.route')
  const rows = new Map<string, { userId: string; encryptedPayload: string; updatedAt: string }>()
  const dialect = new PgDialect()
  t.mock.method(db, 'select', () => ({
    from: () => ({
      where: async (condition: SQL) => {
        const userId = dialect.sqlToQuery(condition).params[0] as string
        const row = rows.get(userId)
        return row ? [row] : []
      },
    }),
  }))
  t.mock.method(db, 'insert', () => ({
    values: (row: { userId: string; encryptedPayload: string; updatedAt: string }) => ({
      onConflictDoUpdate: async () => {
        rows.set(row.userId, row)
      },
      onConflictDoNothing: async () => {
        if (!rows.has(row.userId)) rows.set(row.userId, row)
      },
    }),
  }))
  const app = Fastify()
  app.addHook('onRequest', (request, reply, done) => {
    const userId = request.headers['x-test-user']
    if (typeof userId !== 'string') {
      void reply.status(401).send()
      return
    }
    runWithCurrentUser({ userId, email: null, authMode: 'supabase' }, done)
  })
  await app.register(modelSettingsRoute)
  const payload = {
    llm: { baseUrl: 'https://example.com', modelName: 'model-a', apiKey: 'test-secret' },
    savedLlmConnections: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        savedAt: new Date().toISOString(),
        baseUrl: 'https://example.com',
        modelName: 'model-a',
        apiKey: 'test-secret',
      },
    ],
  }
  try {
    assert.equal((await app.inject({ method: 'GET', url: '/model-settings' })).statusCode, 401)
    const saved = await app.inject({
      method: 'PUT',
      url: '/model-settings',
      headers: { 'x-test-user': 'a' },
      payload: { ...payload, userId: 'b' },
    })
    assert.equal(saved.statusCode, 200)
    assert.ok(rows.has('a'))
    assert.ok(!rows.has('b'))
    assert.ok(!rows.get('a')!.encryptedPayload.includes('test-secret'))
    const restored = await app.inject({ method: 'GET', url: '/model-settings', headers: { 'x-test-user': 'a' } })
    assert.equal(restored.headers['cache-control'], 'no-store')
    assert.deepEqual(restored.json().settings, payload)
    const other = await app.inject({ method: 'GET', url: '/model-settings', headers: { 'x-test-user': 'b' } })
    assert.equal(other.json().settings, null)
    const migrated = await app.inject({
      method: 'POST',
      url: '/model-settings',
      headers: { 'x-test-user': 'a' },
      payload: { ...payload, savedLlmConnections: [] },
    })
    assert.deepEqual(migrated.json().settings, payload)
    const beforeFailure = rows.get('a')!.encryptedPayload
    delete process.env.MODEL_CONFIG_ENCRYPTION_KEY
    const failed = await app.inject({ method: 'PUT', url: '/model-settings', headers: { 'x-test-user': 'a' }, payload })
    assert.equal(failed.statusCode, 503)
    assert.equal(rows.get('a')!.encryptedPayload, beforeFailure)
  } finally {
    await app.close()
    await closeDatabase()
    if (previousUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousUrl
    if (previousKey === undefined) delete process.env.MODEL_CONFIG_ENCRYPTION_KEY
    else process.env.MODEL_CONFIG_ENCRYPTION_KEY = previousKey
  }
})
