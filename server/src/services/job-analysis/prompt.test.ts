import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod'
import { createValidationRepairContext, parseModelOutputJson } from './prompt'

test('模型输出解析支持 Markdown JSON 代码块', () => {
  assert.deepEqual(parseModelOutputJson('```json\n{"matchScore": 82}\n```'), { matchScore: 82 })
})

test('模型输出解析可提取解释文字中的完整 JSON 对象', () => {
  assert.deepEqual(parseModelOutputJson('分析完成：{"matchScore": 82, "summary": "匹配"}'), {
    matchScore: 82,
    summary: '匹配',
  })
})

test('结构化校验失败时保留字段路径和原始值，供修复 Prompt 使用', () => {
  const schema = z.object({ matchScore: z.number() })
  const result = schema.safeParse({ matchScore: '82' })

  assert.equal(result.success, false)
  if (result.success) return

  const repairContext = createValidationRepairContext('{"matchScore":"82"}', result.error)
  assert.deepEqual(repairContext.validationIssues?.[0]?.path, ['matchScore'])
  assert.match(repairContext.invalidFieldValues, /82/)
})
