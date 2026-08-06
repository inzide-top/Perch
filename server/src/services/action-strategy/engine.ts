import { createHash } from 'node:crypto'
import type { JobOpportunityStatus } from '@/types/opportunity'
import type { DashboardHistoricalWeakness } from '@/types/dashboard'
import type {
  StrategyAction,
  StrategyCapabilityAction,
  StrategyPriority,
  StrategyWaitingStage,
} from '@/types/action-strategy'
import type {
  ActionStrategyBuildResult,
  StrategyCapabilityCandidateInput,
  StrategyCapabilityContext,
  StrategyCandidateInput,
  StrategyOpportunityContext,
} from './types'

const priorityRank: Record<StrategyPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
}

const intentionRank: Record<StrategyOpportunityContext['intentionLevel'], number> = {
  S: 0,
  A: 1,
  B: 2,
  C: 3,
}

const activeOpportunityStatuses: JobOpportunityStatus[] = ['applied', 'written_test', 'interviewing', 'oc']

function parseDate(value: string | null | undefined) {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

function startOfDay(value: number) {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** 第一版只排除周六、周日，不把节假日误算成精确事实。 */
export function countBusinessDaysBetween(from: string | null | undefined, to: string | Date = new Date()) {
  const fromTime = parseDate(from)
  const toTime = typeof to === 'string' ? parseDate(to) : to.getTime()
  if (fromTime === null || toTime === null || toTime <= fromTime) return 0

  let cursor = startOfDay(fromTime)
  const end = startOfDay(toTime)
  let businessDays = 0

  while (cursor < end) {
    const day = new Date(cursor).getDay()
    if (day !== 0 && day !== 6) businessDays += 1
    cursor += 24 * 60 * 60 * 1000
  }

  return businessDays
}

function formatBusinessDays(days: number) {
  return days > 0 ? `已 ${days} 个工作日没有新的流程记录` : '最近仍在正常等待阶段'
}

function getLatestActivityAt(opportunity: StrategyOpportunityContext) {
  const historyAt = [...opportunity.statusHistory]
    .map((item) => item.createdAt)
    .sort((left, right) => (parseDate(right) ?? 0) - (parseDate(left) ?? 0))[0]

  return historyAt ?? opportunity.updatedAt
}

function getWaitingStage(days: number): StrategyWaitingStage {
  if (days >= 15) return 'long_stalled'
  if (days >= 8) return 'stalled'
  if (days >= 4) return 'follow_up'
  return 'normal'
}

function getStagePriority(stage: StrategyWaitingStage): StrategyPriority | null {
  if (stage === 'follow_up') return 'high'
  if (stage === 'stalled') return 'high'
  if (stage === 'long_stalled') return 'medium'
  return null
}

function getUpcomingEvent(opportunity: StrategyOpportunityContext, nowMs: number) {
  const events = [
    opportunity.writtenTestScheduledAt
      ? {
          type: 'written_test' as const,
          title: '笔试',
          scheduledAt: opportunity.writtenTestScheduledAt,
        }
      : null,
    ...opportunity.interviewRounds
      .filter((round) => round.status === 'planned' && round.scheduledAt)
      .map((round) => ({
        type: 'interview' as const,
        title: round.title || `第 ${round.id.slice(0, 4)} 轮面试`,
        scheduledAt: round.scheduledAt as string,
      })),
  ].filter((event): event is { type: 'written_test' | 'interview'; title: string; scheduledAt: string } => {
    if (!event) return false
    const timestamp = parseDate(event.scheduledAt)
    return timestamp !== null && timestamp >= nowMs
  })

  return (
    events.sort((left, right) => (parseDate(left.scheduledAt) ?? 0) - (parseDate(right.scheduledAt) ?? 0))[0] ?? null
  )
}

function getPastPlannedEvent(opportunity: StrategyOpportunityContext, nowMs: number) {
  const events = [
    opportunity.writtenTestScheduledAt && !opportunity.writtenTestReviewedAt
      ? { type: 'written_test' as const, title: '笔试', scheduledAt: opportunity.writtenTestScheduledAt }
      : null,
    ...opportunity.interviewRounds
      .filter((round) => round.status === 'planned' && round.scheduledAt)
      .map((round) => ({
        type: 'interview' as const,
        title: round.title || '面试',
        scheduledAt: round.scheduledAt as string,
      })),
  ].filter((event): event is { type: 'written_test' | 'interview'; title: string; scheduledAt: string } => {
    if (!event) return false
    const timestamp = parseDate(event.scheduledAt)
    return timestamp !== null && timestamp < nowMs
  })

  return (
    events.sort((left, right) => (parseDate(right.scheduledAt) ?? 0) - (parseDate(left.scheduledAt) ?? 0))[0] ?? null
  )
}

function actionCta(type: StrategyAction['type'], opportunityId?: string): StrategyAction['cta'] {
  if (type === 'train_capability') return { label: '去训练', to: '/opportunities' }
  if (!opportunityId) return { label: '查看机会', to: '/opportunities' }
  if (type === 'retry_analysis' || type === 'reanalyze_current_resume') {
    return { label: '查看机会', to: `/opportunities/${opportunityId}` }
  }
  return { label: '查看机会', to: `/opportunities/${opportunityId}` }
}

function getOpportunityActions(opportunity: StrategyOpportunityContext, nowMs: number): StrategyCandidateInput[] {
  const candidates: StrategyCandidateInput[] = []
  const analysis = opportunity.analysis
  const analysisScore = analysis?.status === 'completed' ? analysis.matchScore : null
  const analysisLabel = analysisScore === null ? '尚未有可用匹配度' : `匹配度 ${analysisScore} 分`
  const intentionLabel = `${opportunity.intentionLevel} 级意向`

  if (analysis?.status === 'failed') {
    candidates.push({
      key: '',
      type: 'retry_analysis',
      priority: opportunity.intentionLevel === 'S' || opportunity.intentionLevel === 'A' ? 'high' : 'medium',
      company: opportunity.company,
      jobTitle: opportunity.jobTitle,
      status: opportunity.status,
      intentionLevel: opportunity.intentionLevel,
      matchScore: null,
      waitingStage: null,
      facts: ['最近一次 JD 分析失败', intentionLabel],
      opportunityId: opportunity.id,
      cta: actionCta('retry_analysis', opportunity.id),
    })
  }

  const upcomingEvent = getUpcomingEvent(opportunity, nowMs)
  if (upcomingEvent) {
    const daysUntilEvent = Math.ceil(((parseDate(upcomingEvent.scheduledAt) ?? nowMs) - nowMs) / (24 * 60 * 60 * 1000))
    if (daysUntilEvent <= 2) {
      candidates.push({
        key: '',
        type: upcomingEvent.type === 'interview' ? 'prepare_interview' : 'prepare_written_test',
        priority: 'urgent',
        company: opportunity.company,
        jobTitle: opportunity.jobTitle,
        status: opportunity.status,
        intentionLevel: opportunity.intentionLevel,
        matchScore: analysisScore,
        waitingStage: null,
        facts: [`${upcomingEvent.title}将在 ${Math.max(daysUntilEvent, 0)} 天内开始`, analysisLabel, intentionLabel],
        opportunityId: opportunity.id,
        cta: actionCta(
          upcomingEvent.type === 'interview' ? 'prepare_interview' : 'prepare_written_test',
          opportunity.id,
        ),
      })
    }
  }

  const pastPlannedEvent = getPastPlannedEvent(opportunity, nowMs)
  if (pastPlannedEvent) {
    candidates.push({
      key: '',
      type: 'complete_event_record',
      priority: 'urgent',
      company: opportunity.company,
      jobTitle: opportunity.jobTitle,
      status: opportunity.status,
      intentionLevel: opportunity.intentionLevel,
      matchScore: analysisScore,
      waitingStage: null,
      facts: [`${pastPlannedEvent.title}安排时间已过去，但还没有完成记录`, intentionLabel],
      opportunityId: opportunity.id,
      cta: actionCta('complete_event_record', opportunity.id),
    })
  }

  if (
    opportunity.status === 'pending_apply' &&
    (opportunity.intentionLevel === 'S' || opportunity.intentionLevel === 'A')
  ) {
    if (analysisScore !== null && analysisScore >= 60) {
      candidates.push({
        key: '',
        type: 'submit_application',
        priority: 'high',
        company: opportunity.company,
        jobTitle: opportunity.jobTitle,
        status: opportunity.status,
        intentionLevel: opportunity.intentionLevel,
        matchScore: analysisScore,
        waitingStage: null,
        facts: [`${intentionLabel}，${analysisLabel}`, '当前仍处于待投递阶段'],
        opportunityId: opportunity.id,
        cta: actionCta('submit_application', opportunity.id),
      })
    }
  }

  if (activeOpportunityStatuses.includes(opportunity.status)) {
    const daysSinceActivity = countBusinessDaysBetween(getLatestActivityAt(opportunity), new Date(nowMs))
    const waitingStage = getWaitingStage(daysSinceActivity)
    const priority = getStagePriority(waitingStage)
    if (priority) {
      const type = waitingStage === 'long_stalled' ? 'lower_priority' : 'follow_up'
      candidates.push({
        key: '',
        type,
        priority,
        company: opportunity.company,
        jobTitle: opportunity.jobTitle,
        status: opportunity.status,
        intentionLevel: opportunity.intentionLevel,
        matchScore: analysisScore,
        waitingStage,
        facts: [formatBusinessDays(daysSinceActivity), `${intentionLabel}，${analysisLabel}`],
        opportunityId: opportunity.id,
        cta: actionCta(type, opportunity.id),
      })
    }
  }

  return candidates
}

function sortCandidates(left: StrategyCandidateInput, right: StrategyCandidateInput) {
  if (priorityRank[left.priority] !== priorityRank[right.priority]) {
    return priorityRank[left.priority] - priorityRank[right.priority]
  }
  if (intentionRank[left.intentionLevel] !== intentionRank[right.intentionLevel]) {
    return intentionRank[left.intentionLevel] - intentionRank[right.intentionLevel]
  }
  if ((right.matchScore ?? -1) !== (left.matchScore ?? -1)) {
    return (right.matchScore ?? -1) - (left.matchScore ?? -1)
  }
  return `${left.company}${left.jobTitle}`.localeCompare(`${right.company}${right.jobTitle}`, 'zh-CN')
}

function materializeAction(candidate: StrategyCandidateInput, index: number): StrategyAction {
  const titleByType: Record<StrategyAction['type'], string> = {
    prepare_interview: '优先准备即将到来的面试',
    prepare_written_test: '优先准备即将到来的笔试',
    complete_event_record: '补充已经结束的面试或笔试记录',
    submit_application: '推进高意向机会投递',
    follow_up: '建议礼貌跟进这条机会',
    lower_priority: '降低这条停滞机会的优先级',
    retry_analysis: '重新生成 JD 匹配分析',
    reanalyze_current_resume: '用当前简历版本重新分析',
    train_capability: '针对性补强能力',
  }

  const suggestedStepByType: Record<StrategyAction['type'], string> = {
    prepare_interview: '打开机会详情，进入模拟面试或查看相关复盘。',
    prepare_written_test: '打开机会详情，确认笔试要求并补充准备记录。',
    complete_event_record: '将这次安排标记为已完成，再补充真实复盘内容。',
    submit_application: '确认 JD 和简历版本后，把机会推进到已投递。',
    follow_up: '先查看最近一次进展，再决定是否发送礼貌跟进。',
    lower_priority: '保留记录，暂时把时间投入到更有进展的机会。',
    retry_analysis: '检查模型配置后重新发起分析。',
    reanalyze_current_resume: '使用当前简历版本重新生成匹配结果。',
    train_capability: '围绕这个能力开始一轮有边界的模拟训练。',
  }

  return {
    key: candidate.key || `A${index + 1}`,
    type: candidate.type,
    priority: candidate.priority,
    title: titleByType[candidate.type],
    reason: candidate.facts.join('；'),
    suggestedStep: suggestedStepByType[candidate.type],
    evidence: candidate.facts,
    opportunityId: candidate.opportunityId,
    company: candidate.company,
    jobTitle: candidate.jobTitle,
    status: candidate.status,
    intentionLevel: candidate.intentionLevel,
    matchScore: candidate.matchScore,
    ...(candidate.waitingStage ? { waitingStage: candidate.waitingStage } : {}),
    cta: candidate.cta,
  }
}

function materializeCapabilityAction(
  candidate: StrategyCapabilityCandidateInput,
  index: number,
): StrategyCapabilityAction {
  const priority: StrategyPriority = candidate.masteryScore < 50 ? 'high' : 'medium'
  return {
    key: candidate.key || `C${index + 1}`,
    type: 'train_capability',
    priority,
    title: `补强：${candidate.label}`,
    reason: `${candidate.sourceLabel}；当前掌握度 ${candidate.masteryScore} 分`,
    suggestedStep: '在下一轮模拟面试中把这个能力设为重点验证主题。',
    evidence: [candidate.sourceLabel, `${candidate.evidenceCount} 次证据`, `${candidate.masteryScore} 分`],
    capabilityKey: candidate.capabilityKey,
    capabilityLabel: candidate.label,
    confidence: candidate.confidence,
    opportunityId: candidate.opportunityId,
    company: candidate.company,
    jobTitle: candidate.jobTitle,
    cta: candidate.cta,
  }
}

function toCapabilityCandidate(weakness: StrategyCapabilityContext, index: number): StrategyCapabilityCandidateInput {
  return {
    key: `C${index + 1}`,
    capabilityKey: weakness.capabilityKey,
    label: weakness.label,
    confidence: weakness.confidence,
    evidenceCount: weakness.evidenceCount,
    sourceLabel: weakness.sourceLabel,
    masteryScore: weakness.masteryScore,
    cta: actionCta('train_capability'),
  }
}

export function buildActionStrategy(input: {
  opportunities: StrategyOpportunityContext[]
  capabilities?: StrategyCapabilityContext[]
  historicalWeaknesses?: DashboardHistoricalWeakness[]
  now?: Date
}): ActionStrategyBuildResult {
  const now = input.now ?? new Date()
  const nowMs = now.getTime()
  const allCandidates = input.opportunities.flatMap((opportunity) => getOpportunityActions(opportunity, nowMs))
  const sortedCandidates = allCandidates.sort(sortCandidates)
  const selectedCandidates = sortedCandidates.slice(0, 10)

  const capabilities = [
    ...(input.capabilities ?? []),
    ...(input.historicalWeaknesses ?? []).map((weakness) => ({
      capabilityKey: weakness.topicKey,
      label: weakness.topicLabel,
      confidence: weakness.confidence,
      evidenceCount: weakness.confidence === 'high' ? 2 : 1,
      masteryScore: weakness.masteryScore,
      sourceLabel: `历史薄弱项：${weakness.summary}`,
      observedAt: weakness.lastObservedAt,
    })),
  ]
  const uniqueCapabilities = [...new Map(capabilities.map((item) => [item.capabilityKey, item])).values()]
    .sort((left, right) => {
      if (left.masteryScore !== right.masteryScore) return left.masteryScore - right.masteryScore
      if (right.evidenceCount !== left.evidenceCount) return right.evidenceCount - left.evidenceCount
      return right.observedAt.localeCompare(left.observedAt)
    })
    .slice(0, 5)

  const actionCandidates = selectedCandidates.map((candidate, index) => ({
    ...candidate,
    key: `A${index + 1}`,
  }))
  const capabilityCandidates = uniqueCapabilities.map(toCapabilityCandidate)
  const actions = actionCandidates.map(materializeAction)
  const capabilityActions = capabilityCandidates.map((candidate, index) =>
    materializeCapabilityAction(candidate, index),
  )

  const runInput: ActionStrategyBuildResult['runInput'] = {
    generatedAt: now.toISOString(),
    sourceSummary: {
      opportunityCount: input.opportunities.length,
      upcomingEventCount: input.opportunities.filter((opportunity) => getUpcomingEvent(opportunity, nowMs)).length,
      stalledOpportunityCount: actionCandidates.filter(
        (candidate) => candidate.waitingStage === 'stalled' || candidate.waitingStage === 'long_stalled',
      ).length,
      completedAnalysisCount: input.opportunities.filter((opportunity) => opportunity.analysis?.status === 'completed')
        .length,
      capabilityEvidenceCount: uniqueCapabilities.length,
    },
    actionCandidates: actionCandidates.map(({ opportunityId: _opportunityId, cta: _cta, ...candidate }) => candidate),
    capabilityCandidates: capabilityCandidates.map(
      ({
        masteryScore: _masteryScore,
        opportunityId: _opportunityId,
        company: _company,
        jobTitle: _jobTitle,
        cta: _cta,
        ...candidate
      }) => candidate,
    ),
  }

  const fingerprintSource = {
    sourceSummary: runInput.sourceSummary,
    actionCandidates: runInput.actionCandidates,
    capabilityCandidates: runInput.capabilityCandidates,
  }
  const currentFingerprint = createHash('sha256').update(JSON.stringify(fingerprintSource)).digest('hex')

  return {
    generatedAt: now.toISOString(),
    currentFingerprint,
    sourceSummary: runInput.sourceSummary,
    actions,
    capabilityActions,
    runInput,
    actionCandidates,
    capabilityCandidates,
  }
}
