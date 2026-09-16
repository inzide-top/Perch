import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { appAuthMode } from './auth-mode'

let client: SupabaseClient | null = null

function readSupabaseConfiguration() {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

  if (!url || !publishableKey) {
    throw new Error('正式登录尚未配置，请设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_PUBLISHABLE_KEY')
  }

  return { url, publishableKey }
}

export function getSupabaseClient() {
  if (appAuthMode !== 'supabase') {
    throw new Error('当前运行模式不使用 Supabase 登录')
  }

  if (client) return client

  const { url, publishableKey } = readSupabaseConfiguration()
  client = createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })

  return client
}

export async function getAuthAccessToken() {
  if (appAuthMode !== 'supabase') return null

  const { data, error } = await getSupabaseClient().auth.getSession()
  if (error) throw error
  return data.session?.access_token ?? null
}

export async function refreshAuthAccessToken() {
  if (appAuthMode !== 'supabase') return null

  const { data, error } = await getSupabaseClient().auth.refreshSession()
  if (error) return null
  return data.session?.access_token ?? null
}

export async function invalidateAuthSession() {
  if (appAuthMode !== 'supabase') return
  await getSupabaseClient().auth.signOut({ scope: 'local' })
}
