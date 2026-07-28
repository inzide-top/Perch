export type ThemeMode = 'system' | 'light' | 'dark'

export type LlmConnectionSettings = {
  baseUrl: string
  modelName: string
  apiKey: string
}

export type AppSettings = {
  themeMode: ThemeMode
  llm: LlmConnectionSettings
}
