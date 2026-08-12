function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function collectOpportunityIds(value: unknown, result: Set<string>) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectOpportunityIds(item, result))
    return
  }
  if (!value || typeof value !== 'object') return

  Object.entries(value).forEach(([key, item]) => {
    if (key === 'opportunityId' && typeof item === 'string' && isUuid(item)) {
      result.add(item)
      return
    }
    if (key === 'opportunityIds' && Array.isArray(item)) {
      item.forEach((id) => {
        if (typeof id === 'string' && isUuid(id)) result.add(id)
      })
      return
    }
    collectOpportunityIds(item, result)
  })
}

export function collectChatMemoryOpportunityIds(values: readonly unknown[], initialIds: readonly string[] = []) {
  const result = new Set(initialIds.filter(isUuid))
  values.forEach((value) => collectOpportunityIds(value, result))
  return [...result]
}
