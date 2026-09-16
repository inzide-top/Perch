import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveServerAuthMode } from './auth'

test('明确配置的身份模式优先于部署环境', () => {
  assert.equal(resolveServerAuthMode({ AUTH_MODE: 'development', NODE_ENV: 'production' }), 'development')
  assert.equal(resolveServerAuthMode({ AUTH_MODE: 'interview', NODE_ENV: 'production' }), 'interview')
  assert.equal(resolveServerAuthMode({ AUTH_MODE: 'supabase', APP_DEPLOYMENT_MODE: 'interview' }), 'supabase')
})

test('未明确配置时保持开发、面试和正式环境的兼容规则', () => {
  assert.equal(resolveServerAuthMode({}), 'development')
  assert.equal(resolveServerAuthMode({ APP_DEPLOYMENT_MODE: 'interview' }), 'interview')
  assert.equal(resolveServerAuthMode({ NODE_ENV: 'production' }), 'supabase')
})

test('身份模式拼写错误时直接拒绝启动', () => {
  assert.throws(() => resolveServerAuthMode({ AUTH_MODE: 'production' }))
})
