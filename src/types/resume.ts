export type Resume = {
  id: string
  title: string
  currentVersionId: string
  createdAt: string
  updatedAt: string
}

export type TextDiffSegment = {
  value: string
  added?: boolean
  removed?: boolean
}

export type VersionDiffItem = {
  field: string
  label: string
  before: unknown
  after: unknown
  textSegments?: TextDiffSegment[]
}

export type ResumeVersion = {
  id: string
  resumeId: string
  versionNumber: number
  parentVersionId: string | null
  content: ResumeContent
  diffSummary: VersionDiffItem[]
  changeNote: string
  createdAt: string
  updatedAt: string
}

export type ResumeContent = {
  targetDirection: string
  name: string
  address?: string[]
  educationLevel?: EducationLevel
  school?: string
  major?: string
  graduationYear?: string
  currentStatus?: CurrentStatus
  jobSearchIdentity?: JobSearchIdentity
  portfolioLinks?: PortfolioLink[]
  languages?: LanguageAbility[]
  workExperiences?: WorkExperience[]
  comment?: string
  skills: string
  projects: {
    id: string
    name: string
    role: string
    techStack: string
    description: string
    content: string
    outcomes?: string
  }[]
}

export type ResumeDraft = ResumeContent & {
  title: string
}

export type EducationLevel = 'college_or_below' | 'bachelor' | 'master' | 'doctor_or_above'

export type CurrentStatus = 'employed' | 'unemployed' | 'fresh_graduate' | 'studying' | 'interning'

export type JobSearchIdentity = 'campus' | 'experienced' | 'internship'

export type LanguageAbilityLevel =
  'basic' | 'reading_writing' | 'daily_communication' | 'working_professional' | 'fluent'

export type LanguageAbility = {
  id: string
  language: string
  level: LanguageAbilityLevel
}

export type PortfolioLink = {
  id: string
  label: string
  url: string
}

export type WorkExperience = {
  id: string
  companyName: string
  industry?: string
  department?: string
  jobTitle: string
  period: {
    start: string
    end: string
  }
}

export type ResumeSkillSignal = {
  name: string
  category: 'framework' | 'language' | 'tooling' | 'engineering' | 'ai_native' | 'business'
  level: 'expert' | 'proficient' | 'familiar' | 'basic'
  evidence: string
}

export type ResumeProjectSignal = {
  projectId: string
  projectName: string
  role: string
  businessDomain: string
  technicalHighlights: string[]
  measurableOutcomes: string[]
  evidence: string
}

export type ResumeAnalysis = {
  id: string
  resumeId: string
  resumeVersionId: string
  sourceTitle: string
  targetDirection: string
  profileSummary: string
  cityPreference: {
    cities: string[]
    flexibility: 'high' | 'medium' | 'low'
    reason: string
  }
  rolePositioning: string[]
  skillSignals: ResumeSkillSignal[]
  projectSignals: ResumeProjectSignal[]
  strengths: string[]
  risks: string[]
  createdAt: string
}
