import { defineStore } from 'pinia'
import type { AppSettings, LlmConnectionSettings, SavedLlmConnectionSettings, ThemeMode } from '@/types/settings'

const settingsStoreStorageKey = 'agent-seek-employment:settings-store'

type SettingsState = AppSettings

const defaultLlmSettings: LlmConnectionSettings = {
  baseUrl: 'https://api.deepseek.com',
  modelName: 'deepseek-chat',
  apiKey: '',
}

function canUseLocalStorage() {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

function normalizeThemeMode(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

function normalizeLlmSettings(value: Partial<LlmConnectionSettings> | undefined): LlmConnectionSettings {
  return {
    baseUrl: typeof value?.baseUrl === 'string' ? value.baseUrl : defaultLlmSettings.baseUrl,
    modelName: typeof value?.modelName === 'string' ? value.modelName : defaultLlmSettings.modelName,
    apiKey: typeof value?.apiKey === 'string' ? value.apiKey : defaultLlmSettings.apiKey,
  }
}

function normalizeSavedLlmConnections(value: unknown): SavedLlmConnectionSettings[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []

    const candidate = item as Partial<SavedLlmConnectionSettings>
    if (typeof candidate.id !== 'string' || candidate.id === '') return []
    if (typeof candidate.savedAt !== 'string' || candidate.savedAt === '') return []

    const connection = normalizeLlmSettings(candidate)
    if (!connection.baseUrl || !connection.modelName) return []

    return [{ id: candidate.id, savedAt: candidate.savedAt, ...connection }]
  })
}

function createSavedConnectionId() {
  return crypto.randomUUID()
}

export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => ({
    themeMode: 'system',
    llm: { ...defaultLlmSettings },
    savedLlmConnections: [],
  }),

  actions: {
    hydrateFromStorage() {
      if (!canUseLocalStorage()) return

      const storedState = localStorage.getItem(settingsStoreStorageKey)
      if (!storedState) return

      try {
        const parsedState = JSON.parse(storedState) as Partial<AppSettings>

        this.themeMode = normalizeThemeMode(parsedState.themeMode)
        this.llm = normalizeLlmSettings(parsedState.llm)
        this.savedLlmConnections = normalizeSavedLlmConnections(parsedState.savedLlmConnections)
      } catch {
        localStorage.removeItem(settingsStoreStorageKey)
      }
    },

    persistToStorage() {
      if (!canUseLocalStorage()) return

      localStorage.setItem(
        settingsStoreStorageKey,
        JSON.stringify({
          themeMode: this.themeMode,
          llm: this.llm,
          savedLlmConnections: this.savedLlmConnections,
        }),
      )
    },

    setThemeMode(themeMode: ThemeMode) {
      this.themeMode = themeMode
      this.persistToStorage()
    },

    updateLlmSettings(payload: LlmConnectionSettings) {
      this.llm = {
        baseUrl: payload.baseUrl.trim(),
        modelName: payload.modelName.trim(),
        apiKey: payload.apiKey.trim(),
      }
      this.persistToStorage()
    },

    saveLlmAsReusable(payload: LlmConnectionSettings) {
      const currentConnection = normalizeLlmSettings(payload)
      const existingConnection = this.savedLlmConnections.find(
        (connection) =>
          connection.baseUrl === currentConnection.baseUrl && connection.modelName === currentConnection.modelName,
      )
      const savedConnection: SavedLlmConnectionSettings = {
        id: existingConnection?.id ?? createSavedConnectionId(),
        savedAt: new Date().toISOString(),
        ...currentConnection,
      }

      this.savedLlmConnections = [
        savedConnection,
        ...this.savedLlmConnections.filter((connection) => connection.id !== savedConnection.id),
      ]
      this.persistToStorage()

      return savedConnection
    },

    deleteSavedLlmConnection(connectionId: string) {
      const connectionIndex = this.savedLlmConnections.findIndex((connection) => connection.id === connectionId)
      if (connectionIndex === -1) return false

      this.savedLlmConnections.splice(connectionIndex, 1)
      this.persistToStorage()

      return true
    },

    useSavedLlmConnection(connectionId: string) {
      const connection = this.savedLlmConnections.find((item) => item.id === connectionId)
      if (!connection) return null

      this.llm = {
        baseUrl: connection.baseUrl,
        modelName: connection.modelName,
        apiKey: connection.apiKey,
      }
      this.persistToStorage()

      return connection
    },
  },
})
