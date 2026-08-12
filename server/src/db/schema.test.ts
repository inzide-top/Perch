import assert from 'node:assert/strict'
import test from 'node:test'
import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  agentRuns,
  chatArtifacts,
  chatCommands,
  chatConversations,
  chatMemoryDocuments,
  chatMessages,
  chatRunEvents,
  chatRuns,
  chatToolActions,
} from './schema'

type TableConfig = ReturnType<typeof getTableConfig>

function columnNames(config: TableConfig) {
  return config.columns.map((column) => column.name)
}

function hasIndex(config: TableConfig, name: string) {
  return config.indexes.some((index) => index.config.name === name)
}

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
