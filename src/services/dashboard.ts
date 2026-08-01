import type { DashboardOverview } from '@/types/dashboard'
import { request, type RequestOptions } from './http'

export const dashboardApi = {
  getOverview(options: RequestOptions = {}) {
    return request.get<DashboardOverview>('/dashboard/overview', options)
  },
}
