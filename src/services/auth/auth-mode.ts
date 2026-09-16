export type AppAuthMode = 'development' | 'interview' | 'supabase'

function readConfiguredMode(): AppAuthMode | null {
  const value = import.meta.env.VITE_AUTH_MODE
  return value === 'development' || value === 'interview' || value === 'supabase' ? value : null
}

export function resolveAppAuthMode(): AppAuthMode {
  const configuredMode = readConfiguredMode()
  if (configuredMode) return configuredMode

  if (import.meta.env.VITE_APP_DEPLOYMENT_MODE === 'interview') return 'interview'
  return import.meta.env.PROD ? 'supabase' : 'development'
}

export const appAuthMode = resolveAppAuthMode()
