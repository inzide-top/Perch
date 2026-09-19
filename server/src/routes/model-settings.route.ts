import type { FastifyPluginAsync } from 'fastify'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { userModelSettings } from '../db/schema'
import { getCurrentUserId } from '../context/current-user'
import { decryptModelSettings, encryptModelSettings } from '../services/model-settings-crypto'

const connection = z.object({
  baseUrl: z.string().max(2048),
  modelName: z.string().max(256),
  apiKey: z.string().max(16384),
})
const settingsSchema = z.object({
  llm: connection,
  savedLlmConnections: z.array(connection.extend({ id: z.string().uuid(), savedAt: z.string().datetime() })).max(100),
})

export const modelSettingsRoute: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
  })

  app.get('/model-settings', async (_request, reply) => {
    const userId = await getCurrentUserId()
    const [row] = await db.select().from(userModelSettings).where(eq(userModelSettings.userId, userId))
    if (!row) return { settings: null }
    try {
      return { settings: settingsSchema.parse(decryptModelSettings(row.encryptedPayload, userId)) }
    } catch {
      return reply
        .status(503)
        .send({ message: '模型配置暂时无法解密，请联系管理员检查加密密钥。原配置仍保留，请勿重复覆盖。' })
    }
  })

  app.route({
    method: ['PUT', 'POST'],
    url: '/model-settings',
    bodyLimit: 2 * 1024 * 1024,
    handler: async (request, reply) => {
      const parsed = settingsSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ message: '模型配置格式无效，最多支持保存 100 组配置。' })
      const userId = await getCurrentUserId()
      let encryptedPayload: string
      try {
        encryptedPayload = encryptModelSettings(parsed.data, userId)
      } catch {
        return reply
          .status(503)
          .send({ message: '服务器尚未配置模型配置加密密钥，请联系管理员配置 MODEL_CONFIG_ENCRYPTION_KEY' })
      }
      const updatedAt = new Date().toISOString()
      if (request.method === 'POST') {
        // Migration is create-only: another device's existing configuration must win.
        await db.insert(userModelSettings).values({ userId, encryptedPayload, updatedAt }).onConflictDoNothing()
        const [row] = await db.select().from(userModelSettings).where(eq(userModelSettings.userId, userId))
        try {
          return { settings: settingsSchema.parse(decryptModelSettings(row!.encryptedPayload, userId)) }
        } catch {
          return reply.status(503).send({ message: '模型配置暂时无法解密，请联系管理员检查加密密钥。' })
        }
      }
      await db.insert(userModelSettings).values({ userId, encryptedPayload, updatedAt }).onConflictDoUpdate({
        target: userModelSettings.userId,
        set: { encryptedPayload, updatedAt },
      })
      return { settings: parsed.data }
    },
  })
}
