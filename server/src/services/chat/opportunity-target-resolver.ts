import type { JobOpportunityRecord } from '../../repositories/opportunity.repository'

export type OpportunityTargetResolution =
  | { status: 'resolved'; opportunity: JobOpportunityRecord }
  | {
      status: 'needs_selection'
      reason: 'missing_reference' | 'ambiguous_reference' | 'not_found'
      candidates: JobOpportunityRecord[]
    }

function normalizeReference(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s·•・|/\\()（）【】[\]_-]+/g, '')
}

function getNormalizedOpportunityFields(opportunity: JobOpportunityRecord) {
  const company = normalizeReference(opportunity.company)
  const jobTitle = normalizeReference(opportunity.jobTitle)
  const addresses = (opportunity.address ?? []).map(normalizeReference).filter(Boolean)
  const combined = `${company}${jobTitle}`
  return {
    company,
    jobTitle,
    addresses,
    combined,
    addressQualified: addresses.map((address) => `${combined}${address}`),
  }
}

/**
 * 只做确定性实体解析：唯一匹配才自动选择，缺失、撞名或未命中都交给用户确认。
 */
export function resolveOpportunityTarget(input: {
  opportunities: JobOpportunityRecord[]
  reference?: string
  selectedOpportunityId?: string
  candidateLimit?: number
}): OpportunityTargetResolution {
  const candidateLimit = input.candidateLimit ?? 20

  if (input.selectedOpportunityId) {
    const selected = input.opportunities.find((item) => item.id === input.selectedOpportunityId)
    if (!selected) throw new Error('所选机会不存在或不属于当前用户')
    return { status: 'resolved', opportunity: selected }
  }

  const reference = input.reference?.trim()
  if (!reference) {
    return {
      status: 'needs_selection',
      reason: 'missing_reference',
      candidates: input.opportunities.slice(0, candidateLimit),
    }
  }

  const normalizedReference = normalizeReference(reference)
  const exactMatches = input.opportunities.filter((opportunity) => {
    const fields = getNormalizedOpportunityFields(opportunity)
    return (
      fields.company === normalizedReference ||
      fields.jobTitle === normalizedReference ||
      fields.combined === normalizedReference ||
      fields.addressQualified.includes(normalizedReference)
    )
  })
  if (exactMatches.length === 1) return { status: 'resolved', opportunity: exactMatches[0]! }
  if (exactMatches.length > 1) {
    return {
      status: 'needs_selection',
      reason: 'ambiguous_reference',
      candidates: exactMatches.slice(0, candidateLimit),
    }
  }

  const fuzzyMatches = input.opportunities.filter((opportunity) => {
    const fields = getNormalizedOpportunityFields(opportunity)
    return (
      fields.company.includes(normalizedReference) ||
      fields.jobTitle.includes(normalizedReference) ||
      fields.combined.includes(normalizedReference) ||
      normalizedReference.includes(fields.combined) ||
      fields.addressQualified.some(
        (qualifiedReference) =>
          qualifiedReference.includes(normalizedReference) || normalizedReference.includes(qualifiedReference),
      )
    )
  })
  if (fuzzyMatches.length === 1) return { status: 'resolved', opportunity: fuzzyMatches[0]! }

  return {
    status: 'needs_selection',
    reason: fuzzyMatches.length > 1 ? 'ambiguous_reference' : 'not_found',
    candidates: (fuzzyMatches.length > 0 ? fuzzyMatches : input.opportunities).slice(0, candidateLimit),
  }
}
