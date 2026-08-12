import assert from 'node:assert/strict'
import test from 'node:test'
import type { requestModelCompletion } from './ai/model-client'
import { ModelRequestError } from './ai/model-client'
import { importResumeFromPdf, ResumePdfImportError } from './resume-pdf-import.service'

const modelConnection = {
  baseUrl: 'https://model.example.com/v1',
  modelName: 'test-model',
  apiKey: 'test-key',
}

function createCompletion(rawOutput: string) {
  return async () => ({ rawOutput, tokenUsage: null })
}

test('PDF 简历导入会规范城市、补充客户端 ID，并保留项目为可确认草稿', async () => {
  const result = await importResumeFromPdf(
    { fileName: '张晨-前端.pdf', buffer: Buffer.from('unused'), modelConnection },
    {
      extractPdfText: async () => ({ text: '张晨 前端工程师 Vue 3', pageCount: 2, characterCount: 18 }),
      requestCompletion: createCompletion(
        JSON.stringify({
          title: '张晨-前端开发',
          targetDirection: '前端开发工程师',
          name: '张晨',
          address: ['杭州市', '杭州'],
          educationLevel: 'bachelor',
          school: '示例大学',
          major: '计算机科学',
          graduationYear: '2024',
          currentStatus: 'employed',
          jobSearchIdentity: 'experienced',
          portfolioLinks: [{ label: 'GitHub', url: 'https://github.com/example' }],
          languages: [{ language: '英语', level: 'working_professional' }],
          workExperiences: [
            {
              companyName: '示例科技',
              industry: '互联网',
              department: '研发部',
              jobTitle: '前端工程师',
              period: { start: '2024-01', end: 'present' },
            },
          ],
          comment: null,
          skills: 'Vue 3、TypeScript',
          projects: [
            {
              name: '求职助手',
              role: '前端工程师',
              techStack: 'Vue 3',
              description: 'AI 求职管理应用',
              content: '负责前端架构',
              outcomes: '完成上线',
            },
          ],
        }),
      ) as typeof requestModelCompletion,
    },
  )

  assert.deepEqual(result.draft.address, ['杭州'])
  assert.ok(result.draft.projects[0]?.id)
  assert.ok(result.draft.workExperiences[0]?.id)
  assert.ok(result.recognizedFields.includes('projects'))
  assert.deepEqual(result.missingRequiredFields, [])
  assert.equal(result.source.pageCount, 2)
})

test('第一次结构化结果失败时会携带错误原因重试一次', async () => {
  const prompts: string[] = []
  let attempt = 0
  const result = await importResumeFromPdf(
    { fileName: 'resume.pdf', buffer: Buffer.from('unused'), modelConnection },
    {
      extractPdfText: async () => ({ text: '张晨 前端工程师', pageCount: 1, characterCount: 8 }),
      requestCompletion: (async (_key, _connection, _system, userPrompt) => {
        prompts.push(userPrompt)
        attempt += 1
        return {
          rawOutput:
            attempt === 1
              ? 'not-json'
              : JSON.stringify({ name: '张晨', targetDirection: '前端工程师', skills: 'Vue 3' }),
          tokenUsage: null,
        }
      }) as typeof requestModelCompletion,
      waitBeforeRetry: async () => undefined,
    },
  )

  assert.equal(attempt, 2)
  assert.match(prompts[1] ?? '', /上次输出无法使用/)
  assert.match(prompts[1] ?? '', /root:/)
  assert.equal(result.draft.name, '张晨')
})

test('常见模型字段变体会先无损归一化，再进入严格简历结构校验', async () => {
  let attempt = 0
  const result = await importResumeFromPdf(
    { fileName: 'deepseek-resume.pdf', buffer: Buffer.from('unused'), modelConnection },
    {
      extractPdfText: async () => ({ text: '张晨 前端工程师 Vue TypeScript', pageCount: 1, characterCount: 28 }),
      requestCompletion: (async () => {
        attempt += 1
        return {
          rawOutput: JSON.stringify({
            name: '张晨',
            targetDirection: '前端工程师',
            address: null,
            portfolioLinks: ['https://github.com/example'],
            workExperiences: [
              {
                company: '示例科技',
                department: '研发部',
                title: '前端工程师',
                startDate: '2024-01',
                endDate: 'present',
              },
            ],
            skills: ['Vue 3', 'TypeScript'],
            languages: [{ language: 'English', level: 'working_professional' }],
            projects: [
              {
                name: '求职助手',
                description: 'AI 求职管理应用',
                content: '负责前端架构',
                techStack: ['Vue 3', 'TypeScript'],
              },
            ],
          }),
          tokenUsage: null,
        }
      }) as typeof requestModelCompletion,
    },
  )

  assert.equal(attempt, 1)
  assert.equal(result.draft.skills, 'Vue 3, TypeScript')
  assert.equal(result.draft.languages[0]?.language, '英语')
  assert.deepEqual(result.draft.address, [])
  assert.equal(result.draft.portfolioLinks[0]?.url, 'https://github.com/example')
  assert.equal(result.draft.workExperiences[0]?.companyName, '示例科技')
  assert.equal(result.draft.workExperiences[0]?.jobTitle, '前端工程师')
  assert.deepEqual(result.draft.workExperiences[0]?.period, { start: '2024-01', end: 'present' })
  assert.equal(result.draft.projects[0]?.techStack, 'Vue 3, TypeScript')
  assert.ok(result.warnings.some((warning) => warning.includes('技能列表')))
  assert.ok(result.warnings.some((warning) => warning.includes('工作经历字段')))
  assert.ok(result.warnings.some((warning) => warning.includes('语言名称')))
})

test('修复提示会覆盖每个失败的顶层字段，不会因错误数量多而遗漏 skills', async () => {
  const prompts: string[] = []
  let attempt = 0
  const result = await importResumeFromPdf(
    { fileName: 'resume.pdf', buffer: Buffer.from('unused'), modelConnection },
    {
      extractPdfText: async () => ({ text: '张晨 前端工程师', pageCount: 1, characterCount: 8 }),
      requestCompletion: (async (_key, _connection, _system, userPrompt) => {
        prompts.push(userPrompt)
        attempt += 1
        return {
          rawOutput:
            attempt === 1
              ? JSON.stringify({
                  name: '张晨',
                  targetDirection: '前端工程师',
                  address: [1],
                  educationLevel: 'invalid',
                  portfolioLinks: [{ label: 1, url: 2 }],
                  languages: [{ language: 1, level: 'invalid' }],
                  workExperiences: [1],
                  comment: [],
                  skills: [{ name: 'Vue 3' }],
                  projects: [{ techStack: [{ name: 'Vue 3' }] }],
                })
              : JSON.stringify({ name: '张晨', targetDirection: '前端工程师', skills: 'Vue 3' }),
          tokenUsage: null,
        }
      }) as typeof requestModelCompletion,
      waitBeforeRetry: async () => undefined,
    },
  )

  assert.equal(attempt, 2)
  assert.match(prompts[1] ?? '', /skills：必须是 string\|null/)
  assert.match(prompts[1] ?? '', /projects：必须是 Array/)
  assert.equal(result.draft.skills, 'Vue 3')
})

test('工作经历缺少非关键结构时保留为待确认草稿，而不是让整次导入失败', async () => {
  const result = await importResumeFromPdf(
    { fileName: 'partial-resume.pdf', buffer: Buffer.from('unused'), modelConnection },
    {
      extractPdfText: async () => ({ text: '张晨 前端工程师', pageCount: 1, characterCount: 8 }),
      requestCompletion: createCompletion(
        JSON.stringify({
          name: '张晨',
          targetDirection: '前端工程师',
          skills: 'Vue 3',
          workExperiences: [{ jobTitle: '前端工程师', period: { start: '2024-01' } }],
        }),
      ) as typeof requestModelCompletion,
    },
  )

  assert.equal(result.draft.workExperiences.length, 1)
  assert.equal(result.draft.workExperiences[0]?.companyName, '')
  assert.deepEqual(result.draft.workExperiences[0]?.period, { start: '2024-01', end: '' })
  assert.ok(result.warnings.some((warning) => warning.includes('待确认草稿')))
})

test('可恢复的模型请求错误由后端有限重试，第三次成功后正常返回', async () => {
  let attempt = 0
  const startedAttempts: number[] = []
  const failedAttempts: number[] = []
  const completedAttempts: number[] = []
  const result = await importResumeFromPdf(
    { fileName: 'resume.pdf', buffer: Buffer.from('unused'), modelConnection },
    {
      extractPdfText: async () => ({ text: '张晨 前端工程师', pageCount: 1, characterCount: 8 }),
      requestCompletion: (async () => {
        attempt += 1
        if (attempt < 3) throw new ModelRequestError('模型服务暂时不可用', 'model_request_failed', true)
        return {
          rawOutput: JSON.stringify({ name: '张晨', targetDirection: '前端工程师', skills: 'Vue 3' }),
          tokenUsage: null,
        }
      }) as typeof requestModelCompletion,
      waitBeforeRetry: async () => undefined,
      lifecycle: {
        onAttemptStarted: ({ attemptNumber }) => void startedAttempts.push(attemptNumber),
        onAttemptFailed: ({ attemptNumber }) => void failedAttempts.push(attemptNumber),
        onAttemptCompleted: ({ attemptNumber }) => void completedAttempts.push(attemptNumber),
      },
    },
  )

  assert.equal(attempt, 3)
  assert.deepEqual(startedAttempts, [1, 2, 3])
  assert.deepEqual(failedAttempts, [1, 2])
  assert.deepEqual(completedAttempts, [3])
  assert.equal(result.draft.name, '张晨')
})

test('无有效 PDF 文件头时在调用模型前拒绝', async () => {
  await assert.rejects(
    () => importResumeFromPdf({ fileName: 'fake.pdf', buffer: Buffer.from('not-a-pdf'), modelConnection }),
    (error: unknown) => error instanceof ResumePdfImportError && error.message.includes('不是有效的 PDF'),
  )
})

test('模型额度错误会保留明确业务提示而不是退化成通用 500', async () => {
  let attempt = 0
  await assert.rejects(
    () =>
      importResumeFromPdf(
        { fileName: 'resume.pdf', buffer: Buffer.from('unused'), modelConnection },
        {
          extractPdfText: async () => ({ text: '张晨 前端工程师', pageCount: 1, characterCount: 8 }),
          requestCompletion: (async () => {
            attempt += 1
            throw new ModelRequestError('当前模型额度已用完', 'model_quota_exhausted', false)
          }) as typeof requestModelCompletion,
        },
      ),
    (error: unknown) =>
      error instanceof ResumePdfImportError && error.statusCode === 402 && error.message.includes('额度已用完'),
  )
  assert.equal(attempt, 1)
})
