import { AsyncLocalStorage } from 'node:async_hooks'
import { getBuiltInUserId, serverAuthMode } from '../config/auth'

export type CurrentUserIdentity = {
  userId: string
  email: string | null
  authMode: 'development' | 'interview' | 'supabase'
}

const currentUserStorage = new AsyncLocalStorage<CurrentUserIdentity>()

export function runWithCurrentUser<T>(identity: CurrentUserIdentity, callback: () => T) {
  return currentUserStorage.run(identity, callback)
}

export function getCurrentUser() {
  const identity = currentUserStorage.getStore()
  if (identity) return identity

  if (serverAuthMode !== 'supabase') {
    return {
      userId: getBuiltInUserId(serverAuthMode),
      email: null,
      authMode: serverAuthMode,
    } satisfies CurrentUserIdentity
  }

  throw new Error('当前请求缺少已经验证的用户身份')
}

export async function getCurrentUserId() {
  return getCurrentUser().userId
}
