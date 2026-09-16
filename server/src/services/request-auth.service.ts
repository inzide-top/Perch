import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getBuiltInUserId, readServerSupabaseConfiguration, serverAuthMode } from '../config/auth'
import type { CurrentUserIdentity } from '../context/current-user'

export class UnauthorizedRequestError extends Error {
  readonly statusCode = 401

  constructor(message = '登录状态已失效，请重新登录') {
    super(message)
    this.name = 'UnauthorizedRequestError'
  }
}

let authClient: SupabaseClient | null = null

function getServerAuthClient() {
  if (authClient) return authClient

  const { url, publishableKey } = readServerSupabaseConfiguration()
  authClient = createClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  return authClient
}

function readBearerToken(authorization: string | undefined) {
  if (!authorization) throw new UnauthorizedRequestError('请先登录后再继续')

  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (!match?.[1]) throw new UnauthorizedRequestError('登录凭证格式不正确')
  return match[1].trim()
}

export async function authenticateRequest(authorization: string | undefined): Promise<CurrentUserIdentity> {
  if (serverAuthMode !== 'supabase') {
    return {
      userId: getBuiltInUserId(serverAuthMode),
      email: null,
      authMode: serverAuthMode,
    }
  }

  const token = readBearerToken(authorization)
  const { data, error } = await getServerAuthClient().auth.getClaims(token)
  if (error || !data?.claims.sub) throw new UnauthorizedRequestError()

  return {
    userId: data.claims.sub,
    email: typeof data.claims.email === 'string' ? data.claims.email : null,
    authMode: 'supabase',
  }
}
