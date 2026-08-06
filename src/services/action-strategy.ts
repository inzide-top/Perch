import type { ActionStrategyGenerateResult, ActionStrategyOverview } from '@/types/action-strategy'
import { request } from './http'

export const actionStrategyApi = {
  getOverview() {
    return request.get<ActionStrategyOverview>('/action-strategy')
  },

  generate(modelConnection: { baseUrl: string; modelName: string; apiKey: string }) {
    return request.post<ActionStrategyGenerateResult>('/action-strategy/generate', { modelConnection })
  },
}
