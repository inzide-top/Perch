export type OpportunityMutationResultStatus = 'completed' | 'skipped' | 'rejected' | 'failed'

export type OpportunityMutationSummaryItem = {
  toolActionId: string
  opportunityId: string
  company: string
  jobTitle: string
  operationLabel: string
  status: OpportunityMutationResultStatus
  changes: Array<{
    label: string
    before: string
    after: string
  }>
  errorMessage: string | null
}

export type OpportunityMutationSummaryPart = {
  type: 'opportunity_mutation_summary'
  items: OpportunityMutationSummaryItem[]
}

export type OpportunityMutationGroup<T> =
  { type: 'original'; part: T } | { type: 'summary'; part: OpportunityMutationSummaryPart }

/**
 * 只合并相邻、已经结束的机会修改卡片。等待用户操作的卡片必须保留原样，
 * 否则用户会失去确认、取消或填写入口。
 */
export function groupOpportunityMutationParts<T>(
  parts: readonly T[],
  toSummaryItem: (part: T) => OpportunityMutationSummaryItem | null,
): OpportunityMutationGroup<T>[] {
  const result: OpportunityMutationGroup<T>[] = []
  let pending: Array<{ original: T; summary: OpportunityMutationSummaryItem }> = []

  const flush = () => {
    if (pending.length >= 2) {
      result.push({
        type: 'summary',
        part: { type: 'opportunity_mutation_summary', items: pending.map((item) => item.summary) },
      })
    } else if (pending.length === 1) {
      result.push({ type: 'original', part: pending[0]!.original })
    }
    pending = []
  }

  for (const part of parts) {
    const summary = toSummaryItem(part)
    if (summary) {
      pending.push({ original: part, summary })
      continue
    }

    flush()
    result.push({ type: 'original', part })
  }

  flush()
  return result
}
