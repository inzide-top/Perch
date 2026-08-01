import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getRecommendationFromScore,
  getScoreDimensionLabel,
} from '../../../src/shared/opportunity/analysisPresentation'

test('匹配推荐与分数区间保持一一对应', () => {
  assert.equal(getRecommendationFromScore(0), 'not_recommended')
  assert.equal(getRecommendationFromScore(29), 'not_recommended')
  assert.equal(getRecommendationFromScore(30), 'risky')
  assert.equal(getRecommendationFromScore(59), 'risky')
  assert.equal(getRecommendationFromScore(60), 'worth_trying')
  assert.equal(getRecommendationFromScore(89), 'worth_trying')
  assert.equal(getRecommendationFromScore(90), 'strong_match')
  assert.equal(getRecommendationFromScore(100), 'strong_match')
})

test('六个固定评分维度使用稳定的展示文案', () => {
  assert.equal(getScoreDimensionLabel('related_experience'), '相关经验匹配')
  assert.equal(getScoreDimensionLabel('job_constraints'), '岗位约束匹配')
})
