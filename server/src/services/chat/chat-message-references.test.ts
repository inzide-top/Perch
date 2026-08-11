import assert from 'node:assert/strict'
import test from 'node:test'
import type { JobOpportunityRecord } from '../../repositories/opportunity.repository'
import { resolveChatMessageReferences, toReferenceContextMessage } from './chat-message-references'

const opportunity = {
  id: '00000000-0000-4000-8000-000000000001',
  userId: 'user-1',
  company: '微派',
  jobTitle: '前端开发工程师（会玩海外）',
} as JobOpportunityRecord

test('消息机会引用由服务端补齐标签并生成仅属于当前轮次的上下文', async () => {
  const resolved = await resolveChatMessageReferences({
    userId: 'user-1',
    conversationOpportunityId: null,
    references: [{ type: 'opportunity', id: opportunity.id }],
    findOpportunityById: async () => opportunity,
    getOpportunityContextForUser: async () => ({ opportunity: { id: opportunity.id }, profile: { industry: '游戏' } }),
  })

  assert.deepEqual(resolved[0]?.reference, {
    type: 'opportunity',
    id: opportunity.id,
    label: '微派 · 前端开发工程师（会玩海外）',
  })
  const contextMessage = toReferenceContextMessage(resolved)
  assert.equal(contextMessage?.role, 'system')
  assert.match(contextMessage?.content ?? '', /只适用于紧随其后的用户消息/)
  assert.match(contextMessage?.content ?? '', /微派 · 前端开发工程师/)
})

test('消息机会引用拒绝其他用户数据和重复引用会话已绑定机会', async () => {
  await assert.rejects(
    resolveChatMessageReferences({
      userId: 'user-2',
      conversationOpportunityId: null,
      references: [{ type: 'opportunity', id: opportunity.id }],
      findOpportunityById: async () => opportunity,
      getOpportunityContextForUser: async () => ({}),
    }),
    /引用的岗位机会不存在/,
  )

  await assert.rejects(
    resolveChatMessageReferences({
      userId: 'user-1',
      conversationOpportunityId: opportunity.id,
      references: [{ type: 'opportunity', id: opportunity.id }],
      findOpportunityById: async () => opportunity,
      getOpportunityContextForUser: async () => ({}),
    }),
    /当前会话已经绑定该机会/,
  )
})
