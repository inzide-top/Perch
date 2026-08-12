import type { JobOpportunityStatus } from '@/types/opportunity'

function getStatusFlow(includeWrittenTest: boolean): Exclude<JobOpportunityStatus, 'closed'>[] {
  return includeWrittenTest
    ? ['pending_apply', 'applied', 'written_test', 'interviewing', 'oc', 'offered']
    : ['pending_apply', 'applied', 'interviewing', 'oc', 'offered']
}

export function isAllowedStatusTransition(
  fromStatus: Exclude<JobOpportunityStatus, 'closed'>,
  toStatus: Exclude<JobOpportunityStatus, 'closed'>,
  includeWrittenTest: boolean,
) {
  if (fromStatus === toStatus) return true
  const flow = getStatusFlow(includeWrittenTest)

  // 状态表示用户当前真实进度，不强制补写并未确认发生过的中间阶段。
  // written_test 只有在机会开启笔试流程时才会出现在 flow 中，因此仍会被这条规则拦截。
  return flow.includes(fromStatus) && flow.includes(toStatus)
}
