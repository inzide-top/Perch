import assert from 'node:assert/strict'
import test from 'node:test'
import { getAiTaskErrorPresentation } from './ai-errors'

test('模型配置失败保留服务端白名单提示', () => {
  const message = '该模型服务暂不支持，请使用管理员允许的模型服务地址'
  const result = getAiTaskErrorPresentation({ code: 'model_configuration_invalid', message, retryable: false })
  assert.equal(result.description, message)
  assert.equal(result.requiresModelAttention, true)
})

test('缺失配置原因时仍展示可操作的回退说明', () => {
  const result = getAiTaskErrorPresentation({ code: 'model_configuration_invalid', message: '' })
  assert.match(result.description, /Base URL/)
})
