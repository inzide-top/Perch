import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

function encryptionKey() {
  const raw = process.env.MODEL_CONFIG_ENCRYPTION_KEY?.trim() ?? ''
  if (!/^[a-fA-F0-9]{64}$/.test(raw)) {
    throw new Error('服务器尚未配置模型配置加密密钥，请联系管理员配置 MODEL_CONFIG_ENCRYPTION_KEY')
  }
  return Buffer.from(raw, 'hex')
}

export function encryptModelSettings(value: unknown, userId: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  cipher.setAAD(Buffer.from(userId))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.')
}

export function decryptModelSettings(value: string, userId: string): unknown {
  const [version, iv, tag, ciphertext] = value.split('.')
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('模型配置密文格式无效')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'))
  decipher.setAAD(Buffer.from(userId))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return JSON.parse(
    Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8'),
  )
}
