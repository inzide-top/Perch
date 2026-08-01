import assert from 'node:assert/strict'
import test from 'node:test'
import type { InterviewConfiguration } from '@/shared/interview/schemas'
import type { JobAnalysisResult, JobOpportunity } from '@/types/opportunity'
import type { ResumeContent } from '@/types/resume'
import { interviewPlanRunInputSchema } from '../../schemas/interview-plan.schema'
import { buildInterviewPlanRunInput } from './plan-input'

const opportunity: Pick<JobOpportunity, 'company' | 'jobTitle' | 'address' | 'introduction' | 'description'> = {
  company: 'Bilibili',
  jobTitle: 'AI Native 开发工程师',
  address: ['上海'],
  introduction: '负责 AI 应用前端开发。',
  description: '要求具备 TypeScript、工程化和 Agent 应用经验。',
}

const resume: ResumeContent = {
  targetDirection: '前端开发工程师',
  name: '不应进入模型',
  address: ['武汉'],
  school: '不应进入模型',
  portfolioLinks: [{ id: crypto.randomUUID(), label: 'GitHub', url: 'https://github.com/example' }],
  skills: 'TypeScript、Vue、React、前端工程化',
  workExperiences: [
    {
      id: crypto.randomUUID(),
      companyName: '示例公司',
      industry: '企业服务',
      department: '',
      jobTitle: '前端开发工程师',
      period: { start: '2023-07', end: '2025-03' },
    },
  ],
  projects: [
    {
      id: crypto.randomUUID(),
      name: 'AI 求职工作台',
      role: 'AI 应用开发',
      techStack: 'Vue、TypeScript、Fastify',
      description: '面向求职场景的 AI 工作台。',
      content: '负责 Agent 工作流、结构化输出和完整业务闭环。',
      outcomes: '完成可运行产品',
    },
  ],
}

const dimensionKeys = [
  'core_requirements',
  'related_experience',
  'seniority_depth',
  'business_context',
  'bonus_points',
  'job_constraints',
] as const

const analysis: JobAnalysisResult = {
  matchScore: 82,
  recommendation: 'worth_trying',
  summary: '整体值得投递，但 Agent 落地经验仍需验证。',
  locationMatch: {
    resumeCities: ['武汉'],
    jobAddress: '上海',
    isMatched: false,
    impact: 'minor',
    reason: '城市不一致。',
  },
  scoreBreakdown: dimensionKeys.map((key) => ({
    key,
    label: key,
    weight: key === 'core_requirements' ? 50 : 10,
    score: 80,
    reason: '用于测试。',
  })),
  requirementMatches: [
    {
      requirement: 'TypeScript',
      requiredLevel: 'proficient',
      resumeEvidence: '有实际项目经验。',
      candidateLevel: 'proficient',
      matchStatus: 'matched',
      importance: 'must_have',
      risk: 'low',
      suggestion: null,
    },
  ],
  strengths: [
    {
      title: '前端基础扎实',
      evidenceFromJD: '岗位要求 TypeScript。',
      evidenceFromResume: '有多个相关项目。',
      level: 'high',
      reason: '匹配核心要求。',
    },
  ],
  gaps: [
    {
      title: 'Agent 经验需要验证',
      evidenceFromJD: '岗位要求 Agent 落地。',
      level: 'medium',
      reason: '简历证据有限。',
    },
  ],
  resumeSuggestions: [
    {
      targetSection: 'project',
      title: '补充 Agent 细节',
      reason: '提高可信度。',
      priority: 'high',
    },
  ],
  interviewFocus: [
    {
      topic: 'Agent 工作流设计',
      reason: '岗位核心要求。',
      difficulty: 'advanced',
    },
  ],
}

const baseConfiguration: InterviewConfiguration = {
  type: 'foundation',
  scale: 'standard',
  difficulty: 'adaptive',
  referenceHistoricalWeaknesses: true,
  budget: {
    mainTopicBudget: 8,
    totalQuestionBudget: 20,
    maxFollowUpsPerRoot: 3,
  },
}

const weaknesses = Array.from({ length: 6 }, (_, index) => ({
  topicKey: `topic_${index + 1}`,
  topicLabel: `薄弱主题 ${index + 1}`,
  summary: '历史回答未覆盖关键评估点。',
  masteryScore: 40,
  confidence: 'high' as const,
  lastObservedAt: '2026-08-02T10:00:00.000Z',
}))

test('基础面只保留技能、工作摘要和项目简介', () => {
  const input = buildInterviewPlanRunInput({
    opportunity,
    resume,
    analysis,
    configuration: baseConfiguration,
    historicalWeaknesses: weaknesses,
  })

  assert.equal('name' in input.resume, false)
  assert.equal('school' in input.resume, false)
  assert.equal('address' in input.resume, false)
  assert.equal('portfolioLinks' in input.resume, false)
  assert.equal('id' in input.resume.projects[0], false)
  assert.equal('content' in input.resume.projects[0], false)
  assert.equal('outcomes' in input.resume.projects[0], false)
  assert.equal('id' in input.resume.workExperiences[0], false)
})

test('项目面保留完整项目正文，但仍移除内部 ID 和个人信息', () => {
  const input = buildInterviewPlanRunInput({
    opportunity,
    resume,
    analysis,
    configuration: { ...baseConfiguration, type: 'project' },
  })

  assert.equal(input.configuration.type, 'project')
  assert.equal('name' in input.resume, false)
  assert.equal('id' in input.resume.projects[0], false)
  const project = input.resume.projects[0]
  assert.equal('content' in project, true)
  if (!('content' in project)) return
  assert.equal(project.content, resume.projects[0].content)
  assert.equal(project.outcomes, resume.projects[0].outcomes)
})

test('面试计划分析输入排除评分结论、城市匹配和简历优化建议', () => {
  const input = buildInterviewPlanRunInput({
    opportunity,
    resume,
    analysis,
    configuration: baseConfiguration,
  })

  assert.deepEqual(Object.keys(input.analysis).sort(), [
    'gaps',
    'interviewFocus',
    'requirementMatches',
    'scoreBreakdown',
    'strengths',
    'summary',
  ])
  assert.equal('matchScore' in input.analysis, false)
  assert.equal('recommendation' in input.analysis, false)
  assert.equal('locationMatch' in input.analysis, false)
  assert.equal('resumeSuggestions' in input.analysis, false)
})

test('历史薄弱项只在启用时传入，并且最多保留五条', () => {
  const enabled = buildInterviewPlanRunInput({
    opportunity,
    resume,
    analysis,
    configuration: baseConfiguration,
    historicalWeaknesses: weaknesses,
  })
  assert.equal(enabled.historicalWeaknesses.length, 5)

  const disabled = buildInterviewPlanRunInput({
    opportunity,
    resume,
    analysis,
    configuration: { ...baseConfiguration, referenceHistoricalWeaknesses: false },
    historicalWeaknesses: weaknesses,
  })
  assert.deepEqual(disabled.historicalWeaknesses, [])
})

test('真实笔试和面试复盘最多保留八条，并且不受历史薄弱项开关影响', () => {
  const historicalReviews = Array.from({ length: 9 }, (_, index) => ({
    source: index % 2 === 0 ? ('written_test' as const) : ('interview_round' as const),
    title: `历史复盘 ${index + 1}`,
    outcome: 'unknown' as const,
    summary: '用于测试的真实复盘摘要。',
    keyTakeaways: [],
    observedAt: '2026-08-02T10:00:00.000Z',
  }))

  const input = buildInterviewPlanRunInput({
    opportunity,
    resume,
    analysis,
    configuration: { ...baseConfiguration, referenceHistoricalWeaknesses: false },
    historicalReviews,
  })

  assert.equal(input.historicalReviews.length, 8)
  assert.deepEqual(input.historicalWeaknesses, [])
})

test('Schema 拒绝 API Key、数据库 ID 等未声明字段', () => {
  const input = buildInterviewPlanRunInput({
    opportunity,
    resume,
    analysis,
    configuration: baseConfiguration,
  })

  assert.equal(
    interviewPlanRunInputSchema.safeParse({
      ...input,
      apiKey: 'should-never-enter-model-input',
    }).success,
    false,
  )
  assert.equal(
    interviewPlanRunInputSchema.safeParse({
      ...input,
      resumeId: crypto.randomUUID(),
    }).success,
    false,
  )
})
