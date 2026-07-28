import { defineStore } from 'pinia'
import type { AppSettings, LlmConnectionSettings, ThemeMode } from '@/types/settings'

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

export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => ({
    themeMode: 'system',
    llm: { ...defaultLlmSettings },
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
  },
})
