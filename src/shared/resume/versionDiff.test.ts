import assert from 'node:assert/strict'
import test from 'node:test'
import type { LanguageAbility, PortfolioLink, ResumeDraft } from '@/types/resume'
import { getVersionDiff } from './versionDiff'

function createDraft(overrides: Partial<ResumeDraft> = {}): ResumeDraft {
  return {
    title: '前端开发',
    targetDirection: '前端开发',
    name: '测试用户',
    address: ['杭州'],
    educationLevel: 'bachelor',
    school: '',
    major: '',
    graduationYear: '',
    currentStatus: 'employed',
    jobSearchIdentity: 'experienced',
    portfolioLinks: [],
    languages: [],
    workExperiences: [],
    comment: '',
    skills: 'Vue',
    projects: [],
    ...overrides,
  }
}

test('结构化简历字段忽略数据库 JSONB 键顺序和内部 ID 差异', () => {
  const before = createDraft({
    portfolioLinks: [{ id: 'link-before', label: 'GitHub', url: 'https://github.com/example' }],
    languages: [{ id: 'language-before', language: '英语', level: 'reading_writing' }],
    workExperiences: [
      {
        id: 'work-before',
        companyName: '示例公司',
        industry: '互联网',
        department: '研发部',
        jobTitle: '前端开发工程师',
        period: { start: '2024-01', end: '2025-01' },
      },
    ],
  })
  const after = createDraft({
    portfolioLinks: [{ id: 'link-after', url: 'https://github.com/example', label: 'GitHub' } as PortfolioLink],
    languages: [{ id: 'language-after', level: 'reading_writing', language: '英语' } as LanguageAbility],
    workExperiences: [
      {
        id: 'work-after',
        period: { end: '2025-01', start: '2024-01' },
        jobTitle: '前端开发工程师',
        department: '研发部',
        industry: '互联网',
        companyName: '示例公司',
      },
    ],
  })

  assert.deepEqual(getVersionDiff(before, after), [])
})

test('结构化简历字段的真实业务内容变化仍然生成版本差异', () => {
  const before = createDraft({
    portfolioLinks: [{ id: 'link', label: 'GitHub', url: 'https://github.com/example' }],
    languages: [{ id: 'language', language: '英语', level: 'reading_writing' }],
    workExperiences: [
      {
        id: 'work',
        companyName: '示例公司',
        jobTitle: '前端开发工程师',
        period: { start: '2024-01', end: '2025-01' },
      },
    ],
  })
  const after = createDraft({
    portfolioLinks: [{ id: 'link', label: '个人主页', url: 'https://example.com' }],
    languages: [{ id: 'language', language: '英语', level: 'working_professional' }],
    workExperiences: [
      {
        id: 'work',
        companyName: '示例公司',
        jobTitle: '高级前端开发工程师',
        period: { start: '2024-01', end: '2025-01' },
      },
    ],
  })

  assert.deepEqual(
    getVersionDiff(before, after).map((item) => item.field),
    ['portfolioLinks', 'languages', 'workExperiences'],
  )
})
