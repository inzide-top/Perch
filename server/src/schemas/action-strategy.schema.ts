import { z } from 'zod'
import type { ActionStrategyRunInput, ActionStrategyModelOutput } from '../services/action-strategy/types'

const requiredText = z.string().trim().min(1)

export const strategyPrioritySchema = z.enum(['urgent', 'high', 'medium', 'low'])
export const strategyWaitingStageSchema = z.enum(['normal', 'follow_up', 'stalled', 'long_stalled'])
export const strategyActionTypeSchema = z.enum([
  'prepare_interview',
  'prepare_written_test',
  'complete_event_record',
  'submit_application',
  'follow_up',
  'lower_priority',
  'retry_analysis',
  'reanalyze_current_resume',
  'train_capability',
])

const strategySourceSummarySchema = z
  .object({
    opportunityCount: z.number().int().nonnegative(),
    upcomingEventCount: z.number().int().nonnegative(),
    stalledOpportunityCount: z.number().int().nonnegative(),
    completedAnalysisCount: z.number().int().nonnegative(),
    capabilityEvidenceCount: z.number().int().nonnegative(),
  })
  .strict()

const actionCandidateSchema = z
  .object({
    key: z.string().regex(/^A\d+$/),
    type: strategyActionTypeSchema,
    priority: strategyPrioritySchema,
    company: requiredText.max(100),
    jobTitle: requiredText.max(100),
    status: z.enum(['pending_apply', 'applied', 'written_test', 'interviewing', 'oc', 'offered', 'closed']),
    intentionLevel: z.enum(['S', 'A', 'B', 'C']),
    matchScore: z.number().min(0).max(100).nullable(),
    waitingStage: strategyWaitingStageSchema.nullable(),
    facts: z.array(requiredText.max(200)).max(5),
  })
  .strict()

const capabilityCandidateSchema = z
  .object({
    key: z.string().regex(/^C\d+$/),
    capabilityKey: requiredText.max(80),
    label: requiredText.max(100),
    confidence: z.enum(['low', 'medium', 'high']),
    evidenceCount: z.number().int().positive(),
    sourceLabel: requiredText.max(120),
  })
  .strict()

export const actionStrategyRunInputSchema = z
  .object({
    generatedAt: z.string().datetime(),
    sourceSummary: strategySourceSummarySchema,
    actionCandidates: z.array(actionCandidateSchema).max(10),
    capabilityCandidates: z.array(capabilityCandidateSchema).max(5),
  })
  .strict()

const selectedActionSchema = z
  .object({
    actionKey: z.string().regex(/^A\d+$/),
    reason: requiredText.max(240),
    suggestedStep: requiredText.max(160),
  })
  .strict()

const capabilityFocusSchema = z
  .object({
    actionKey: z.string().regex(/^C\d+$/),
    reason: requiredText.max(240),
  })
  .strict()

export const actionStrategyModelOutputSchema = z
  .object({
    headline: requiredText.max(80),
    summary: requiredText.max(320),
    selectedActions: z.array(selectedActionSchema).max(5),
    capabilityFocus: z.array(capabilityFocusSchema).max(3),
  })
  .strict()

export function parseActionStrategyModelOutput(rawOutput: string, input: ActionStrategyRunInput) {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(rawOutput)
  } catch {
    throw new Error('行动策略模型输出不是合法 JSON')
  }

  const parsed = actionStrategyModelOutputSchema.parse(parsedJson)
  const actionKeys = new Set(input.actionCandidates.map((candidate) => candidate.key))
  const capabilityKeys = new Set(input.capabilityCandidates.map((candidate) => candidate.key))
  const seenActions = new Set<string>()
  const seenCapabilities = new Set<string>()

  for (const [index, action] of parsed.selectedActions.entries()) {
    if (!actionKeys.has(action.actionKey)) {
      throw new Error(`selectedActions[${index}].actionKey 不属于当前候选行动`)
    }
    if (seenActions.has(action.actionKey)) {
      throw new Error(`selectedActions[${index}].actionKey 重复引用`)
    }
    seenActions.add(action.actionKey)
  }

  for (const [index, focus] of parsed.capabilityFocus.entries()) {
    if (!capabilityKeys.has(focus.actionKey)) {
      throw new Error(`capabilityFocus[${index}].actionKey 不属于当前能力候选`)
    }
    if (seenCapabilities.has(focus.actionKey)) {
      throw new Error(`capabilityFocus[${index}].actionKey 重复引用`)
    }
    seenCapabilities.add(focus.actionKey)
  }

  const urgentKeys = input.actionCandidates
    .filter((candidate) => candidate.priority === 'urgent')
    .map((candidate) => candidate.key)
  if (urgentKeys.some((key) => !seenActions.has(key))) {
    throw new Error('selectedActions 必须保留所有 urgent 行动')
  }

  return parsed as ActionStrategyModelOutput
}

export type ActionStrategySchemaInput = z.output<typeof actionStrategyRunInputSchema>
export type ActionStrategySchemaOutput = z.output<typeof actionStrategyModelOutputSchema>
