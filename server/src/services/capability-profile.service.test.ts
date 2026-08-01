import assert from 'node:assert/strict'
import test from 'node:test'
process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test'
import type { Resume, ResumeVersion } from '@/types/resume'
import type { JobAnalysisResult } from '@/types/opportunity'
import type { InterviewSessionEvaluation } from '@/shared/interview/schemas'
import type {
  CapabilityInterviewRecord,
  CapabilityJobAnalysisRecord,
} from '../repositories/capability-profile.repository'
import type { CapabilityProfileBuildInput } from './capability-profile.service'

const { buildCapabilityProfile } = await import('./capability-profile.service')

const resume: Resume & { userId: string } = {
  id: '00000000-0000-0000-0000-000000000001',
  userId: 'demo-user',
  title: '前端求职简历',
  currentVersionId: '00000000-0000-0000-0000-000000000002',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
}

const currentVersion: ResumeVersion = {
  id: resume.currentVersionId,
  resumeId: resume.id,
  versionNumber: 2,
  parentVersionId: '00000000-0000-0000-0000-000000000003',
  content: {
    targetDirection: '前端工程师',
    name: '候选人',
    skills: 'Vue、TypeScript、工程化',
    projects: [
      {
        id: 'project-1',
        name: '求职工作台',
        role: '前端负责人',
        techStack: 'Vue 3 / TypeScript',
        description: '搭建求职训练工作台。',
        content: '负责核心页面和交互。',
      },
    ],
  },
  diffSummary: [],
  changeNote: '更新简历',
  createdAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
}

const result: JobAnalysisResult = {
  matchScore: 82,
  recommendation: 'worth_trying',
  summary: '匹配度较高。',
  locationMatch: { resumeCities: [], isMatched: true, impact: 'minor', reason: '地点可接受。' },
  scoreBreakdown: [],
  requirementMatches: [],
  strengths: [
    {
      title: '组件化经验',
      evidenceFromJD: '要求组件化开发',
      evidenceFromResume: '项目中有组件设计',
      level: 'high',
      reason: '有直接项目证据。',
    },
  ],
  gaps: [],
  resumeSuggestions: [],
  interviewFocus: [],
}

const evaluation: InterviewSessionEvaluation = {
  status: 'final',
  score: 78,
  masteryScore: 76,
  communicationScore: 84,
  coverage: { plannedTopics: 2, evaluatedTopics: 2, sufficientTopics: 1 },
  consistency: 'stable',
  topicEvaluations: [
    {
      assessmentPlanId: '00000000-0000-0000-0000-000000000010',
      topicKey: 'frontend_core',
      status: 'solid',
      masteryScore: 78,
      evidenceConfidence: 'high',
      supportingTurnIds: [],
      summary: '组件化理解较扎实。',
    },
    {
      assessmentPlanId: '00000000-0000-0000-0000-000000000010',
      topicKey: 'testing',
      status: 'weak',
      masteryScore: 45,
      evidenceConfidence: 'medium',
      supportingTurnIds: [],
      summary: '测试策略仍需补强。',
    },
  ],
  summary: '整体表现稳定。',
  strengths: ['组件化理解较扎实。'],
  weaknesses: ['测试策略仍需补强。'],
  suggestions: ['补充测试实践。'],
  finalReview: null,
}

function buildInput(overrides: Partial<CapabilityProfileBuildInput> = {}): CapabilityProfileBuildInput {
  return {
    resume,
    currentVersion,
    analyses: [],
    interviewEvidence: [],
    generatedAt: '2026-01-03T00:00:00.000Z',
    ...overrides,
  }
}

function analysisRecord(overrides: Partial<CapabilityJobAnalysisRecord> = {}): CapabilityJobAnalysisRecord {
  return {
    opportunityId: '00000000-0000-0000-0000-000000000020',
    company: '示例公司',
    jobTitle: '前端工程师',
    opportunityStatus: 'interviewing',
    resumeVersionId: currentVersion.id,
    versionNumber: currentVersion.versionNumber,
    status: 'completed',
    updatedAt: '2026-01-02T08:00:00.000Z',
    modelName: 'test-model',
    result,
    ...overrides,
  }
}

function interviewRecord(overrides: Partial<CapabilityInterviewRecord> = {}): CapabilityInterviewRecord {
  return {
    sessionId: '00000000-0000-0000-0000-000000000030',
    opportunityId: '00000000-0000-0000-0000-000000000020',
    company: '示例公司',
    jobTitle: '前端工程师',
    resumeVersionId: currentVersion.id,
    versionNumber: currentVersion.versionNumber,
    status: 'completed',
    evidenceStatus: 'sufficient',
    latestOverallScore: 78,
    evaluation,
    assessmentPlan: null,
    answeredQuestionCount: 4,
    validAnswerCount: 2,
    observedAt: '2026-01-03T00:00:00.000Z',
    ...overrides,
  }
}

test('buildCapabilityProfile keeps current resume evidence and historical JD version markers separate', () => {
  const profile = buildCapabilityProfile(
    buildInput({
      analyses: [
        analysisRecord(),
        analysisRecord({
          opportunityId: '00000000-0000-0000-0000-000000000021',
          resumeVersionId: '00000000-0000-0000-0000-000000000004',
          versionNumber: 1,
        }),
        analysisRecord({
          opportunityId: '00000000-0000-0000-0000-000000000022',
          status: 'processing',
          result: null,
        }),
      ],
      interviewEvidence: [interviewRecord()],
    }),
  )

  assert.equal(profile.scope?.currentVersionNumber, 2)
  assert.equal(profile.jdSignals.length, 2)
  assert.equal(profile.jdSignals[0]?.isCurrentVersion, true)
  assert.equal(profile.jdSignals[1]?.isCurrentVersion, false)
  assert.equal(profile.sourceCounts.pendingJdAnalyses, 1)
  assert.equal(profile.interview.sessions[0]?.isCurrentVersion, true)
  assert.equal(profile.interview.historicalWeaknesses[0]?.topicKey, 'testing')
})

test('buildCapabilityProfile does not infer ability evidence from pending or failed analyses', () => {
  const profile = buildCapabilityProfile(
    buildInput({
      analyses: [
        analysisRecord({ status: 'pending', result: null }),
        analysisRecord({
          opportunityId: '00000000-0000-0000-0000-000000000021',
          status: 'failed',
          result: null,
        }),
      ],
    }),
  )

  assert.deepEqual(profile.jdSignals, [])
  assert.equal(profile.sourceCounts.pendingJdAnalyses, 1)
  assert.equal(profile.sourceCounts.failedJdAnalyses, 1)
  assert.equal(profile.dataStatus, 'partial')
})

test('buildCapabilityProfile returns an empty profile when the selected resume has no evidence', () => {
  const emptyVersion: ResumeVersion = {
    ...currentVersion,
    content: { ...currentVersion.content, skills: '', projects: [] },
  }
  const profile = buildCapabilityProfile(buildInput({ currentVersion: emptyVersion }))

  assert.equal(profile.dataStatus, 'empty')
  assert.deepEqual(profile.resumeDeclaration?.projects, [])
  assert.deepEqual(profile.interview.sessions, [])
})
