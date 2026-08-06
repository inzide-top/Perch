import type { InterviewConfiguration } from '@/shared/interview/schemas'
import type { JobAnalysisResult, JobOpportunity } from '@/types/opportunity'
import type { ResumeContent, WorkExperience } from '@/types/resume'
import {
  interviewPlanRunInputSchema,
  type HistoricalInterviewReview,
  type HistoricalInterviewWeakness,
  type InterviewPlanRunInput,
} from '../../schemas/interview-plan.schema'

type InterviewPlanOpportunitySource = Pick<
  JobOpportunity,
  'company' | 'jobTitle' | 'address' | 'introduction' | 'description'
>

export type BuildInterviewPlanRunInputParams = {
  opportunity: InterviewPlanOpportunitySource
  resume: ResumeContent
  analysis: JobAnalysisResult
  configuration: InterviewConfiguration
  historicalWeaknesses?: HistoricalInterviewWeakness[]
  historicalReviews?: HistoricalInterviewReview[]
}

function normalizeOptionalText(value?: string) {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function mapWorkExperience(experience: WorkExperience) {
  return {
    companyName: experience.companyName,
    industry: normalizeOptionalText(experience.industry),
    department: normalizeOptionalText(experience.department),
    jobTitle: experience.jobTitle,
    period: {
      start: experience.period.start,
      end: experience.period.end,
    },
  }
}

function selectAnalysisInput(analysis: JobAnalysisResult) {
  return {
    summary: analysis.summary,
    scoreBreakdown: analysis.scoreBreakdown,
    requirementMatches: analysis.requirementMatches,
    strengths: analysis.strengths,
    gaps: analysis.gaps,
    interviewFocus: analysis.interviewFocus,
  }
}

function selectHistoricalWeaknesses(configuration: InterviewConfiguration, weaknesses: HistoricalInterviewWeakness[]) {
  if (!configuration.referenceHistoricalWeaknesses) return []
  return weaknesses.slice(0, 5)
}

function selectHistoricalReviews(reviews: HistoricalInterviewReview[]) {
  return reviews.slice(0, 8)
}

/**
 * 从完整业务对象构建最小化模型输入，避免个人信息、内部 ID、密钥和无关分析字段泄漏。
 */
export function buildInterviewPlanRunInput({
  opportunity,
  resume,
  analysis,
  configuration,
  historicalWeaknesses = [],
  historicalReviews = [],
}: BuildInterviewPlanRunInputParams): InterviewPlanRunInput {
  const commonInput = {
    opportunity: {
      company: opportunity.company,
      jobTitle: opportunity.jobTitle,
      address: opportunity.address ?? [],
      introduction: opportunity.introduction,
      description: opportunity.description,
    },
    analysis: selectAnalysisInput(analysis),
    configuration,
    historicalWeaknesses: selectHistoricalWeaknesses(configuration, historicalWeaknesses),
    historicalReviews: selectHistoricalReviews(historicalReviews),
  }

  if (configuration.type === 'foundation') {
    return interviewPlanRunInputSchema.parse({
      ...commonInput,
      resume: {
        targetDirection: resume.targetDirection,
        skills: resume.skills,
        workExperiences: (resume.workExperiences ?? []).map(mapWorkExperience),
        projects: resume.projects.map((project) => ({
          name: project.name,
          role: project.role,
          techStack: project.techStack,
          description: project.description,
        })),
      },
    })
  }

  return interviewPlanRunInputSchema.parse({
    ...commonInput,
    resume: {
      targetDirection: resume.targetDirection,
      skills: resume.skills,
      workExperiences: (resume.workExperiences ?? []).map(mapWorkExperience),
      projects: resume.projects.map((project) => ({
        name: project.name,
        role: project.role,
        techStack: project.techStack,
        description: project.description,
        content: project.content,
        outcomes: normalizeOptionalText(project.outcomes),
      })),
    },
  })
}
