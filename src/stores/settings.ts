import { defineStore } from 'pinia'
import type { AppSettings, LlmConnectionSettings, SavedLlmConnectionSettings, ThemeMode } from '@/types/settings'
import { request } from '@/services/http'
import { getUserErrorMessage } from '@/services/error-presentation'

const settingsStoreStorageKey = 'agent-seek-employment:settings-store'

type ModelSettings = Pick<AppSettings, 'llm' | 'savedLlmConnections'>
type SettingsState = AppSettings & {
  isLoaded: boolean
  isLoading: boolean
  isSaving: boolean
  loadError: string | null
}
let settingsRequest: Promise<void> | null = null

const defaultLlmSettings: LlmConnectionSettings = {
  baseUrl: '',
  modelName: '',
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
    isLoaded: false,
    isLoading: false,
    isSaving: false,
    loadError: null,
  }),

  actions: {
    async loadFromApi() {
      if (this.isLoaded) return
      if (settingsRequest) return settingsRequest
      this.isLoading = true
      this.loadError = null
      settingsRequest = (async () => {
        try {
          let { settings } = await request.get<{ settings: ModelSettings | null }>('/model-settings')
          if (!settings && (this.llm.baseUrl || this.savedLlmConnections.length)) {
            // Migrate only when the account has no server-side configuration.
            const result = await request.post<{ settings: ModelSettings }>('/model-settings', {
              llm: this.llm,
              savedLlmConnections: this.savedLlmConnections,
            })
            settings = result.settings
          }
          if (settings) {
            this.llm = normalizeLlmSettings(settings.llm)
            this.savedLlmConnections = normalizeSavedLlmConnections(settings.savedLlmConnections)
            this.persistToStorage()
          }
          this.isLoaded = true
        } catch (error) {
          this.loadError = getUserErrorMessage(error, '模型配置读取失败，请稍后重试。')
        } finally {
          this.isLoading = false
          settingsRequest = null
        }
      })()
      return settingsRequest
    },

    async ensureLoaded() {
      await this.loadFromApi()
      if (!this.isLoaded) throw new Error(this.loadError ?? '模型配置读取失败，请稍后重试。')
    },

    async saveToApi(settings: ModelSettings) {
      if (this.isSaving) throw new Error('模型配置正在保存，请稍候。')
      this.isSaving = true
      try {
        const result = await request.put<{ settings: ModelSettings }>('/model-settings', settings)
        if (JSON.stringify(this.llm) !== JSON.stringify(result.settings.llm)) this.llm = result.settings.llm
        this.savedLlmConnections = result.settings.savedLlmConnections
        this.persistToStorage()
      } finally {
        this.isSaving = false
      }
    },

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

      try {
        localStorage.setItem(
          settingsStoreStorageKey,
          JSON.stringify({
            themeMode: this.themeMode,
            llm: this.llm,
            savedLlmConnections: this.savedLlmConnections,
          }),
        )
      } catch {
        // Browser cache failure must not turn a successful database save into a failed save.
      }
    },

    setThemeMode(themeMode: ThemeMode) {
      this.themeMode = themeMode
      this.persistToStorage()
    },

    async updateLlmSettings(payload: LlmConnectionSettings) {
      await this.ensureLoaded()
      const llm = {
        baseUrl: payload.baseUrl.trim(),
        modelName: payload.modelName.trim(),
        apiKey: payload.apiKey.trim(),
      }
      await this.saveToApi({ llm, savedLlmConnections: this.savedLlmConnections })
    },

    async saveLlmAsReusable(payload: LlmConnectionSettings) {
      await this.ensureLoaded()
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

      const savedLlmConnections = [
        savedConnection,
        ...this.savedLlmConnections.filter((connection) => connection.id !== savedConnection.id),
      ]
      await this.saveToApi({ llm: this.llm, savedLlmConnections })

      return savedConnection
    },

    async deleteSavedLlmConnection(connectionId: string) {
      await this.ensureLoaded()
      const connectionIndex = this.savedLlmConnections.findIndex((connection) => connection.id === connectionId)
      if (connectionIndex === -1) return false

      await this.saveToApi({
        llm: this.llm,
        savedLlmConnections: this.savedLlmConnections.filter((item) => item.id !== connectionId),
      })

      return true
    },

    async useSavedLlmConnection(connectionId: string) {
      await this.ensureLoaded()
      const connection = this.savedLlmConnections.find((item) => item.id === connectionId)
      if (!connection) return null

      const llm = {
        baseUrl: connection.baseUrl,
        modelName: connection.modelName,
        apiKey: connection.apiKey,
      }
      await this.saveToApi({ llm, savedLlmConnections: this.savedLlmConnections })

      return connection
    },
  },
})
