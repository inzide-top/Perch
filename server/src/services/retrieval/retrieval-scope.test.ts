import assert from 'node:assert/strict'
import test from 'node:test'
import { canRetrieveDocument, createRetrievalDocumentScope } from './retrieval-scope'

test('没有关联机会的对话轮次会成为全局通用记忆', () => {
  assert.deepEqual(
    createRetrievalDocumentScope({
      boundOpportunityId: null,
      relatedOpportunityIds: [],
    }),
    { type: 'global' },
  )
})

test('绑定机会和显式引用都会进入机会记忆边界并去重', () => {
  assert.deepEqual(
    createRetrievalDocumentScope({
      boundOpportunityId: 'xiaomi',
      relatedOpportunityIds: ['xiaomi', 'bilibili'],
    }),
    {
      type: 'opportunity',
      opportunityIds: ['xiaomi', 'bilibili'],
    },
  )
})

test('不同用户之间的记忆永远不能互相检索', () => {
  assert.equal(
    canRetrieveDocument(
      {
        userId: 'user-a',
        currentConversationId: 'conversation-current',
        conversationScopeType: 'global',
        boundOpportunityId: null,
        referencedOpportunityIds: [],
      },
      {
        userId: 'user-b',
        conversationId: 'conversation-other-user',
        scope: { type: 'global' },
      },
    ),
    false,
  )
})

test('全局对话可以检索同一用户的全局记忆和机会记忆', () => {
  const queryScope = {
    userId: 'user-a',
    currentConversationId: 'conversation-current',
    conversationScopeType: 'global' as const,
    boundOpportunityId: null,
    referencedOpportunityIds: [],
  }

  assert.equal(
    canRetrieveDocument(queryScope, {
      userId: 'user-a',
      conversationId: 'conversation-other',
      scope: { type: 'global' },
    }),
    true,
  )
  assert.equal(
    canRetrieveDocument(queryScope, {
      userId: 'user-a',
      conversationId: 'conversation-other',
      scope: { type: 'opportunity', opportunityIds: ['xiaomi'] },
    }),
    true,
  )
})

test('机会对话只能检索全局记忆、绑定机会和本轮显式引用的机会', () => {
  const queryScope = {
    userId: 'user-a',
    currentConversationId: 'conversation-current',
    conversationScopeType: 'opportunity' as const,
    boundOpportunityId: 'xiaomi',
    referencedOpportunityIds: ['bilibili'],
  }

  assert.equal(
    canRetrieveDocument(queryScope, {
      userId: 'user-a',
      conversationId: 'conversation-other',
      scope: { type: 'global' },
    }),
    true,
  )
  assert.equal(
    canRetrieveDocument(queryScope, {
      userId: 'user-a',
      conversationId: 'conversation-other',
      scope: { type: 'opportunity', opportunityIds: ['xiaomi'] },
    }),
    true,
  )
  assert.equal(
    canRetrieveDocument(queryScope, {
      userId: 'user-a',
      conversationId: 'conversation-other',
      scope: { type: 'opportunity', opportunityIds: ['bilibili'] },
    }),
    true,
  )
  assert.equal(
    canRetrieveDocument(queryScope, {
      userId: 'user-a',
      conversationId: 'conversation-other',
      scope: { type: 'opportunity', opportunityIds: ['meituan'] },
    }),
    false,
  )
})

test('当前会话的历史消息已经作为原文装配，不再通过 RAG 重复召回', () => {
  assert.equal(
    canRetrieveDocument(
      {
        userId: 'user-a',
        currentConversationId: 'conversation-current',
        conversationScopeType: 'global',
        boundOpportunityId: null,
        referencedOpportunityIds: [],
      },
      {
        userId: 'user-a',
        conversationId: 'conversation-current',
        scope: { type: 'global' },
      },
    ),
    false,
  )
})
