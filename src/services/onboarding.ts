export const ONBOARDING_TOUR_VERSION = 1

export type OnboardingTourStatus = 'in_progress' | 'completed' | 'skipped'

export type OnboardingProgress = {
  version: number
  status: OnboardingTourStatus
  step: number
  updatedAt: string
}

const storagePrefix = 'perch-onboarding:v1:'

function getStorageKey(userId: string) {
  return `${storagePrefix}${encodeURIComponent(userId)}`
}

function isValidProgress(value: unknown): value is OnboardingProgress {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Partial<OnboardingProgress>
  return (
    candidate.version === ONBOARDING_TOUR_VERSION &&
    (candidate.status === 'in_progress' || candidate.status === 'completed' || candidate.status === 'skipped') &&
    typeof candidate.step === 'number' &&
    Number.isInteger(candidate.step) &&
    candidate.step >= 0 &&
    typeof candidate.updatedAt === 'string'
  )
}

export function readOnboardingProgress(userId: string): OnboardingProgress | null {
  if (typeof localStorage === 'undefined' || !userId) return null

  try {
    const raw = localStorage.getItem(getStorageKey(userId))
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw)
    return isValidProgress(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeOnboardingProgress(userId: string, status: OnboardingTourStatus, step: number) {
  if (typeof localStorage === 'undefined' || !userId) return

  const progress: OnboardingProgress = {
    version: ONBOARDING_TOUR_VERSION,
    status,
    step: Math.max(0, Math.floor(step)),
    updatedAt: new Date().toISOString(),
  }

  try {
    localStorage.setItem(getStorageKey(userId), JSON.stringify(progress))
  } catch {
    // The tour remains usable when browser storage is unavailable or full.
  }
}

export function clearOnboardingProgress(userId: string) {
  if (typeof localStorage === 'undefined' || !userId) return

  try {
    localStorage.removeItem(getStorageKey(userId))
  } catch {
    // Ignore storage failures; this is a non-critical preference.
  }
}
