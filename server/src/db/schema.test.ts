import assert from 'node:assert/strict'
import test from 'node:test'
import { is } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { createFeedbackInputSchema } from '@/shared/feedback/schemas'
import * as applicationSchema from './schema'
import {
  agentRuns,
  chatArtifacts,
  chatCommands,
  chatConversationSummaries,
  chatConversations,
  chatMemoryDocuments,
  chatMessages,
  chatRunEvents,
  chatRuns,
  chatToolActions,
  interviewSessions,
  jobOpportunities,
  userFeedback,
} from './schema'

type TableConfig = ReturnType<typeof getTableConfig>

function columnNames(config: TableConfig) {
  return config.columns.map((column) => column.name)
}

function hasIndex(config: TableConfig, name: string) {
  return config.indexes.some((index) => index.config.name === name)
}

test('所有应用业务表都启用 RLS，禁止 Supabase 浏览器密钥绕过后端直连数据', () => {
  const configs = Object.values(applicationSchema).flatMap((value) =>
    is(value, PgTable) ? [getTableConfig(value)] : [],
  )

  assert.ok(configs.length > 0)
  assert.deepEqual(
    configs.filter((config) => !config.enableRLS).map((config) => config.name),
    [],
  )
})

test('聊天第一版包含会话、消息、Run、事件、工具、Command 和产物七个持久化边界', () => {
  const configs = [
    getTableConfig(chatConversations),
    getTableConfig(chatMessages),
    getTableConfig(chatRuns),
    getTableConfig(chatRunEvents),
    getTableConfig(chatToolActions),
    getTableConfig(chatCommands),
    getTableConfig(chatArtifacts),
  ]

  assert.deepEqual(configs.map((config) => config.name).sort(), [
    'chat_artifacts',
    'chat_commands',
    'chat_conversations',
    'chat_messages',
    'chat_run_events',
    'chat_runs',
    'chat_tool_actions',
  ])

  assert.ok(columnNames(getTableConfig(chatConversations)).includes('scope_type'))
  assert.ok(columnNames(getTableConfig(chatMessages)).includes('replaces_message_id'))
  assert.ok(columnNames(getTableConfig(chatRuns)).includes('runtime_state'))
  assert.ok(columnNames(getTableConfig(chatToolActions)).includes('idempotency_key'))
  assert.ok(columnNames(getTableConfig(chatCommands)).includes('expected_revision'))
  assert.ok(columnNames(getTableConfig(chatArtifacts)).includes('content'))
})

test('聊天状态恢复和幂等关键索引被声明', () => {
  assert.ok(hasIndex(getTableConfig(chatMessages), 'chat_messages_conversation_id_sequence_unique'))
  assert.ok(hasIndex(getTableConfig(chatRuns), 'chat_runs_active_input_message_unique'))
  assert.ok(hasIndex(getTableConfig(chatRuns), 'chat_runs_active_conversation_unique'))
  assert.ok(hasIndex(getTableConfig(chatRuns), 'chat_runs_created_at_id_index'))
  assert.ok(hasIndex(getTableConfig(chatRunEvents), 'chat_run_events_run_id_sequence_unique'))
  assert.ok(hasIndex(getTableConfig(chatToolActions), 'chat_tool_actions_run_id_idempotency_unique'))
  assert.ok(hasIndex(getTableConfig(chatCommands), 'chat_commands_command_id_unique'))

  const scopeCheck = getTableConfig(chatConversations).checks.find(
    (checkConstraint) => checkConstraint.name === 'chat_conversations_scope_relation_check',
  )
  assert.ok(scopeCheck)

  const statusPhaseCheck = getTableConfig(chatRuns).checks.find(
    (checkConstraint) => checkConstraint.name === 'chat_runs_status_phase_check',
  )
  assert.ok(statusPhaseCheck)
})

test('AgentRun 通过 chatRunId 归属聊天工作流并在父 Run 删除时级联清理', () => {
  const config = getTableConfig(agentRuns)
  const chatRunForeignKey = config.foreignKeys.find(
    (foreignKey) => foreignKey.getName() === 'agent_runs_chat_run_id_chat_runs_id_fk',
  )

  assert.ok(chatRunForeignKey)
  assert.equal(chatRunForeignKey.onDelete, 'cascade')
  assert.ok(hasIndex(config, 'agent_runs_chat_run_id_index'))
  assert.ok(hasIndex(config, 'agent_runs_chat_run_id_started_at_index'))
})

test('RAG 记忆表固定向量维度、幂等键、范围索引和级联删除', () => {
  const config = getTableConfig(chatMemoryDocuments)
  const embeddingColumn = config.columns.find((column) => column.name === 'embedding')
  const conversationForeignKey = config.foreignKeys.find(
    (foreignKey) => foreignKey.getName() === 'chat_memory_documents_conversation_id_chat_conversations_id_fk',
  )
  const runForeignKey = config.foreignKeys.find(
    (foreignKey) => foreignKey.getName() === 'chat_memory_documents_run_id_chat_runs_id_fk',
  )

  assert.equal(config.name, 'chat_memory_documents')
  assert.equal(embeddingColumn?.getSQLType(), 'vector(1024)')
  assert.equal(conversationForeignKey?.onDelete, 'cascade')
  assert.equal(runForeignKey?.onDelete, 'cascade')
  assert.ok(hasIndex(config, 'chat_memory_documents_run_id_chunk_index_unique'))
  assert.ok(hasIndex(config, 'chat_memory_documents_user_model_index'))
  assert.ok(hasIndex(config, 'chat_memory_documents_opportunity_ids_index'))
  assert.ok(hasIndex(config, 'chat_memory_documents_embedding_hnsw_index'))
  assert.ok(config.checks.some((constraint) => constraint.name === 'chat_memory_documents_scope_check'))
})

test('聊天上下文摘要独立保存游标，并随会话删除', () => {
  const config = getTableConfig(chatConversationSummaries)
  const conversationForeignKey = config.foreignKeys.find(
    (foreignKey) => foreignKey.getName() === 'chat_conversation_summaries_conversation_id_chat_conversations_id_fk',
  )

  assert.equal(config.name, 'chat_conversation_summaries')
  assert.equal(conversationForeignKey?.onDelete, 'cascade')
  assert.ok(columnNames(config).includes('summarized_through_sequence'))
  assert.ok(columnNames(config).includes('revision'))
  assert.ok(config.checks.some((constraint) => constraint.name === 'chat_conversation_summaries_sequence_check'))
})

test('机会软删除和模拟面试归档字段及索引被声明', () => {
  const opportunityConfig = getTableConfig(jobOpportunities)
  const sessionConfig = getTableConfig(interviewSessions)
  const intentionLevelColumn = opportunityConfig.columns.find((column) => column.name === 'intention_level')

  assert.ok(columnNames(opportunityConfig).includes('deleted_at'))
  assert.equal(intentionLevelColumn?.notNull, false)
  assert.ok(columnNames(sessionConfig).includes('archived_at'))
  assert.ok(hasIndex(sessionConfig, 'interview_sessions_archived_at_index'))
  assert.ok(hasIndex(opportunityConfig, 'job_opportunities_user_dedupe_fingerprint_unique'))
})

test('用户反馈按用户保存，并限制反馈类型和正文边界', () => {
  const config = getTableConfig(userFeedback)

  assert.equal(config.name, 'user_feedback')
  assert.deepEqual(columnNames(config), ['id', 'user_id', 'type', 'content', 'created_at'])
  assert.ok(hasIndex(config, 'user_feedback_user_id_created_at_index'))
  assert.equal(createFeedbackInputSchema.safeParse({ type: 'bug', content: '机会列表无法打开' }).success, true)
  assert.equal(createFeedbackInputSchema.safeParse({ type: 'other', content: '机会列表无法打开' }).success, false)
  assert.equal(createFeedbackInputSchema.safeParse({ type: 'bug', content: '短' }).success, false)
})
