import { defineStore } from 'pinia'
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'
import { appAuthMode, type AppAuthMode } from '@/services/auth/auth-mode'
import { clearAuthenticatedBrowserState, prepareBrowserStateForUser } from '@/services/auth/browser-session'
import { getSupabaseClient } from '@/services/auth/supabase-client'

export type AuthStatus = 'initializing' | 'anonymous' | 'authenticated' | 'error'

export type AuthUserSummary = {
  id: string
  email: string | null
  displayName: string
  isShared: boolean
}

export type SignUpResult = {
  requiresEmailConfirmation: boolean
  accountState: 'created' | 'existing' | 'authenticated'
}

type AuthState = {
  mode: AppAuthMode
  status: AuthStatus
  user: AuthUserSummary | null
  accessToken: string | null
  error: string | null
  initialized: boolean
}

let initializePromise: Promise<void> | null = null
let stopAuthListener: (() => void) | null = null

function getDisplayName(user: User) {
  const metadataName = user.user_metadata.full_name ?? user.user_metadata.name
  if (typeof metadataName === 'string' && metadataName.trim()) return metadataName.trim()
  return user.email?.split('@')[0] || 'PERCH 用户'
}

function toUserSummary(user: User): AuthUserSummary {
  return {
    id: user.id,
    email: user.email ?? null,
    displayName: getDisplayName(user),
    isShared: false,
  }
}

function getBuiltInIdentity(mode: Exclude<AppAuthMode, 'supabase'>): AuthUserSummary {
  if (mode === 'interview') {
    return {
      id: 'interview-demo-user',
      email: null,
      displayName: '面试官体验版本',
      isShared: true,
    }
  }

  return {
    id: 'demo-user',
    email: null,
    displayName: '本地开发账号',
    isShared: false,
  }
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    mode: appAuthMode,
    status: 'initializing',
    user: null,
    accessToken: null,
    error: null,
    initialized: false,
  }),

  getters: {
    isAuthenticated: (state) => state.status === 'authenticated' && state.user !== null,
    requiresLogin: (state) => state.mode === 'supabase',
    isExperienceMode: (state) => state.mode === 'interview',
  },

  actions: {
    applySession(session: Session | null) {
      if (session?.user) prepareBrowserStateForUser(session.user.id)
      else if (this.initialized) clearAuthenticatedBrowserState()
      this.accessToken = session?.access_token ?? null
      this.user = session?.user ? toUserSummary(session.user) : null
      this.status = session?.user ? 'authenticated' : 'anonymous'
      this.error = null
    },

    async initialize() {
      if (this.initialized) return
      if (initializePromise) return initializePromise

      initializePromise = (async () => {
        if (this.mode !== 'supabase') {
          this.user = getBuiltInIdentity(this.mode)
          prepareBrowserStateForUser(this.user.id)
          this.status = 'authenticated'
          this.initialized = true
          return
        }

        try {
          const client = getSupabaseClient()
          const { data, error } = await client.auth.getSession()
          if (error) throw error

          if (!data.session) clearAuthenticatedBrowserState()
          this.applySession(data.session)
          stopAuthListener?.()
          const { data: listener } = client.auth.onAuthStateChange((_event: AuthChangeEvent, session) => {
            this.applySession(session)
          })
          stopAuthListener = () => listener.subscription.unsubscribe()
        } catch (error) {
          this.status = 'error'
          this.user = null
          this.accessToken = null
          this.error = error instanceof Error ? error.message : '登录状态初始化失败'
        } finally {
          this.initialized = true
        }
      })()

      try {
        await initializePromise
      } finally {
        initializePromise = null
      }
    },

    async signIn(email: string, password: string) {
      const { data, error } = await getSupabaseClient().auth.signInWithPassword({ email, password })
      if (error) throw error
      this.applySession(data.session)
    },

    async signUp(email: string, password: string) {
      const { data, error } = await getSupabaseClient().auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth` },
      })
      if (error) throw error
      if (data.session) this.applySession(data.session)
      // Supabase may return an obfuscated user for an existing account when
      // email confirmation is enabled. An empty identities list is the only
      // client-side signal we can safely use without exposing an email lookup
      // endpoint that would allow account enumeration.
      const isExistingAccount = data.user?.identities?.length === 0

      return {
        requiresEmailConfirmation: data.session === null,
        accountState: data.session ? 'authenticated' : isExistingAccount ? 'existing' : 'created',
      } satisfies SignUpResult
    },

    async resendSignupConfirmation(email: string) {
      const { error } = await getSupabaseClient().auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth` },
      })
      if (error) throw error
    },

    async requestPasswordReset(email: string) {
      const { error } = await getSupabaseClient().auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      })
      if (error) throw error
    },

    async updatePassword(password: string) {
      const { error } = await getSupabaseClient().auth.updateUser({ password })
      if (error) throw error
    },

    async signOut() {
      try {
        if (this.mode === 'supabase') {
          const { error } = await getSupabaseClient().auth.signOut({ scope: 'local' })
          if (error) throw error
        }
      } finally {
        clearAuthenticatedBrowserState()
        this.accessToken = null
        this.user = null
        this.status = 'anonymous'
      }
    },
  },
})
