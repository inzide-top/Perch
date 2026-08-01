import type { MatchDimensionKey } from '@/types/opportunity'

export type AnalysisRecommendation = 'strong_match' | 'worth_trying' | 'risky' | 'not_recommended'
export type AnalysisScoreLevel = 'low' | 'medium' | 'good' | 'excellent'

const scoreDimensionLabels: Record<MatchDimensionKey, string> = {
  core_requirements: '核心要求匹配',
  related_experience: '相关经验匹配',
  seniority_depth: '资历深度匹配',
  business_context: '业务场景匹配',
  bonus_points: '加分项匹配',
  job_constraints: '岗位约束匹配',
}

const recommendationLabels: Record<AnalysisRecommendation, string> = {
  strong_match: '强匹配',
  worth_trying: '值得投递',
  risky: '谨慎投递',
  not_recommended: '不建议',
}

const recommendationClasses: Record<AnalysisRecommendation, string> = {
  strong_match: 'is-strong-match',
  worth_trying: 'is-worth-trying',
  risky: 'is-risky',
  not_recommended: 'is-not-recommended',
}

export function getScoreDimensionLabel(key: MatchDimensionKey) {
  return scoreDimensionLabels[key]
}

export function getRecommendationFromScore(score: number): AnalysisRecommendation {
  if (score >= 90) return 'strong_match'
  if (score >= 60) return 'worth_trying'
  if (score >= 30) return 'risky'

  return 'not_recommended'
}

export function getRecommendationLabel(value: AnalysisRecommendation | undefined) {
  return value ? recommendationLabels[value] : '待分析'
}

export function getRecommendationClass(value: AnalysisRecommendation | undefined) {
  return recommendationClasses[value ?? 'not_recommended']
}

export function getScoreLevel(score: number): AnalysisScoreLevel {
  if (score >= 90) return 'excellent'
  if (score >= 60) return 'good'
  if (score >= 30) return 'medium'

  return 'low'
}

export function getScoreClass(score: number) {
  return `is-score-${getScoreLevel(score)}`
}
