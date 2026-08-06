import type { CapabilityProfile } from '@/types/capability'
import { request, type RequestOptions } from './http'

export const capabilityProfileApi = {
  getProfile(resumeId?: string, options: RequestOptions = {}) {
    const query = resumeId ? `?resumeId=${encodeURIComponent(resumeId)}` : ''
    return request.get<CapabilityProfile>(`/capability-profile${query}`, options)
  },
}
