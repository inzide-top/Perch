import type { JobOpportunityStatus, OpportunityStatusChange } from '@/types/opportunity'

/**
 * 返回机会曾经到达过的最深流程位置。
 * 状态历史可能按任意顺序返回，也可能发生阶段回退，因此不能只读取第一条或最后一条记录。
 */
export function getHighestReachedStatusIndex(
  statusFlow: readonly { value: JobOpportunityStatus }[],
  currentStatus: JobOpportunityStatus | null | undefined,
  histories: readonly OpportunityStatusChange[],
) {
  const getIndex = (status: JobOpportunityStatus | null | undefined) =>
    status ? statusFlow.findIndex((item) => item.value === status) : -1
  const reachedIndexes = histories.flatMap((history) => [history.fromStatus, history.toStatus]).map(getIndex)

  return Math.max(getIndex(currentStatus), ...reachedIndexes)
}
