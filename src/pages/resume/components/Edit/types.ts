import type {
  CurrentStatus,
  EducationLevel,
  JobSearchIdentity,
  LanguageAbility,
  LanguageAbilityLevel,
  ResumeContent,
} from '@/types/resume'

export type { LanguageAbility }
export type Project = ResumeContent['projects'][number]
export type WorkExperience = NonNullable<ResumeContent['workExperiences']>[number]
export type ProjectForm = Omit<Project, 'id'>
export type WorkExperienceForm = Omit<WorkExperience, 'id'>
export type LanguageAbilityForm = Omit<LanguageAbility, 'id'>

export type ResumeRequiredField = 'title' | 'targetDirection' | 'name' | 'jobSearchIdentity' | 'skills'
export type ProjectRequiredField = 'name' | 'description' | 'content'
export type WorkExperienceRequiredField = 'companyName' | 'jobTitle' | 'period'

export type SelectOption<T extends string = string> = {
  label: string
  value: T
}

export type ResumeFormState = {
  title: string
  targetDirection: string
  name: string
  address: string[]
  educationLevel: EducationLevel
  school: string
  major: string
  graduationYear: string
  currentStatus: CurrentStatus
  jobSearchIdentity: JobSearchIdentity
  comment: string
  skills: string
}

export type ResumeErrors = Record<ResumeRequiredField, string>
export type ProjectErrors = Record<ProjectRequiredField, string>
export type WorkExperienceErrors = Record<WorkExperienceRequiredField, string>

export type LanguageLevelOption = SelectOption<LanguageAbilityLevel>
export type EducationLevelOption = SelectOption<EducationLevel>
export type CurrentStatusOption = SelectOption<CurrentStatus>
export type JobSearchIdentityOption = SelectOption<JobSearchIdentity>
