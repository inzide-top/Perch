import { z } from 'zod'

export type ServerAuthMode = 'development' | 'interview' | 'supabase'

const authModeSchema = z.enum(['development', 'interview', 'supabase'])

export function resolveServerAuthMode(env: NodeJS.ProcessEnv = process.env): ServerAuthMode {
  if (env.AUTH_MODE) return authModeSchema.parse(env.AUTH_MODE)

  if (env.APP_DEPLOYMENT_MODE === 'interview') return 'interview'
  return env.NODE_ENV === 'production' ? 'supabase' : 'development'
}

export const serverAuthMode = resolveServerAuthMode()

export function getBuiltInUserId(mode: Exclude<ServerAuthMode, 'supabase'>) {
  if (mode === 'interview') return process.env.INTERVIEW_DEMO_USER_ID?.trim() || 'interview-demo-user'
  return process.env.DEVELOPMENT_USER_ID?.trim() || 'demo-user'
}

export function readServerSupabaseConfiguration() {
  const url = process.env.SUPABASE_URL?.trim()
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim()

  if (!url || !publishableKey) {
    throw new Error('Supabase 登录尚未配置，请设置 SUPABASE_URL 和 SUPABASE_PUBLISHABLE_KEY')
  }

  return { url, publishableKey }
}
