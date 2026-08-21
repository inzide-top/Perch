import assert from 'node:assert/strict'
import test from 'node:test'
import { resumeContentSchema } from './resume.schema'

function createResumeContent(period: { start: string; end: string }) {
  return {
    targetDirection: '前端开发',
    name: '测试用户',
    jobSearchIdentity: 'experienced',
    skills: 'Vue, TypeScript',
    workExperiences: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        companyName: '示例科技',
        jobTitle: '前端工程师',
        period,
      },
    ],
  }
}

test('工作经历允许开始月份早于或等于结束月份', () => {
  assert.equal(resumeContentSchema.safeParse(createResumeContent({ start: '2023-08', end: '2026-03' })).success, true)
  assert.equal(resumeContentSchema.safeParse(createResumeContent({ start: '2026-03', end: '2026-03' })).success, true)
})

test('工作经历拒绝开始月份晚于结束月份', () => {
  const result = resumeContentSchema.safeParse(createResumeContent({ start: '2026-03', end: '2025-08' }))

  assert.equal(result.success, false)
  if (result.success) return

  assert.deepEqual(result.error.issues[0]?.path, ['workExperiences', 0, 'period', 'end'])
  assert.equal(result.error.issues[0]?.message, '工作经历的开始时间不能晚于结束时间')
})

test('工作经历兼容 PDF 导入的在职标识，由后续归一化流程处理', () => {
  assert.equal(resumeContentSchema.safeParse(createResumeContent({ start: '2024-01', end: 'present' })).success, true)
})
