import type { OpportunityListFilters } from '@/services/opportunities'

let returnFilters: OpportunityListFilters | null = null

function cloneFilters(filters: OpportunityListFilters): OpportunityListFilters {
  return {
    statuses: [...(filters.statuses ?? [])],
    intentionLevels: [...(filters.intentionLevels ?? [])],
    recommendations: [...(filters.recommendations ?? [])],
    regions: [...(filters.regions ?? [])],
  }
}

export function rememberOpportunityListFilters(filters: OpportunityListFilters) {
  returnFilters = cloneFilters(filters)
}

export function consumeOpportunityListFilters() {
  const filters = returnFilters ? cloneFilters(returnFilters) : null
  returnFilters = null
  return filters
}

export function clearOpportunityListFilters() {
  returnFilters = null
}
