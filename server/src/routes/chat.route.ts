import type { FastifyPluginAsync } from 'fastify'
import {
  chatConversationParamsSchema,
  chatBootstrapQuerySchema,
  chatMessageParamsSchema,
  chatRunEventsQuerySchema,
  chatRunParamsSchema,
  listChatConversationsQuerySchema,
} from '../schemas/chat.schema'
import {
  createChatConversation,
  completeChatOpportunityImportItems,
  createChatTurn,
  deleteChatConversation,
  getChatConversation,
  getChatBootstrap,
  getChatConversations,
  getChatRun,
  getChatRunEvents,
  streamChatRunEvents,
  submitChatCommand,
  updateChatConversation,
} from '../services/chat.service'
import { formatChatSseEvent } from '../services/chat/chat-sse'

export const chatRoute: FastifyPluginAsync = async (app) => {
  app.get('/chat/bootstrap', async (request, reply) => {
    const query = chatBootstrapQuerySchema.parse(request.query)
    const result = await getChatBootstrap(query)
    return reply.status(200).send(result)
  })

  app.post('/chat/conversations', async (request, reply) => {
    const result = await createChatConversation(request.body)
    return reply.status(201).send(result)
  })

  app.get('/chat/conversations', async (request, reply) => {
    const query = listChatConversationsQuerySchema.parse(request.query)
    const result = await getChatConversations(query)
    return reply.status(200).send(result)
  })

  app.get('/chat/conversations/:conversationId', async (request, reply) => {
    const { conversationId } = chatConversationParamsSchema.parse(request.params)
    const result = await getChatConversation(conversationId)
    return reply.status(200).send(result)
  })

  app.patch('/chat/messages/:messageId/opportunity-imports', async (request, reply) => {
    const { messageId } = chatMessageParamsSchema.parse(request.params)
    const result = await completeChatOpportunityImportItems(messageId, request.body)
    return reply.status(200).send(result)
  })

  app.patch('/chat/conversations/:conversationId', async (request, reply) => {
    const { conversationId } = chatConversationParamsSchema.parse(request.params)
    const result = await updateChatConversation(conversationId, request.body)
    return reply.status(200).send(result)
  })

  app.delete('/chat/conversations/:conversationId', async (request, reply) => {
    const { conversationId } = chatConversationParamsSchema.parse(request.params)
    const result = await deleteChatConversation(conversationId)
    return reply.status(200).send(result)
  })

  app.post('/chat/conversations/:conversationId/messages', async (request, reply) => {
    const { conversationId } = chatConversationParamsSchema.parse(request.params)
    const result = await createChatTurn(conversationId, request.body)
    return reply.status(202).send(result)
  })

  app.get('/chat/runs/:runId', async (request, reply) => {
    const { runId } = chatRunParamsSchema.parse(request.params)
    const result = await getChatRun(runId)
    return reply.status(200).send(result)
  })

  app.get('/chat/runs/:runId/events/history', async (request, reply) => {
    const { runId } = chatRunParamsSchema.parse(request.params)
    const query = chatRunEventsQuerySchema.parse(request.query)
    const result = await getChatRunEvents(runId, query)
    return reply.status(200).send(result)
  })

  app.get('/chat/runs/:runId/stream', async (request, reply) => {
    const { runId } = chatRunParamsSchema.parse(request.params)
    const query = chatRunEventsQuerySchema.parse(request.query)

    // 先完成鉴权和参数校验，再切换到手动响应模式，避免流已经开始后才返回 JSON 错误。
    await getChatRun(runId)
    // @fastify/cors 会先把跨域响应头放到 Fastify Reply 上；hijack 后我们改用
    // Node 原生响应写流，因此必须显式把这些头复制过去，否则浏览器会拦截流。
    const corsHeaders = {
      ...(reply.getHeader('vary') ? { vary: String(reply.getHeader('vary')) } : {}),
      ...(reply.getHeader('access-control-allow-origin')
        ? { 'access-control-allow-origin': String(reply.getHeader('access-control-allow-origin')) }
        : {}),
      ...(reply.getHeader('access-control-allow-credentials')
        ? { 'access-control-allow-credentials': String(reply.getHeader('access-control-allow-credentials')) }
        : {}),
    }

    reply.hijack()

    const abortController = new AbortController()
    const closeConnection = () => abortController.abort()
    // 监听响应连接，而不是请求体读取状态。GET 请求本身结束并不代表 SSE 响应应被关闭。
    reply.raw.once('close', closeConnection)
    reply.raw.writeHead(200, {
      ...corsHeaders,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })

    try {
      await streamChatRunEvents(
        runId,
        query,
        (eventName, payload) => {
          if (!abortController.signal.aborted && !reply.raw.writableEnded) {
            reply.raw.write(formatChatSseEvent(eventName, payload))
          }
        },
        abortController.signal,
      )
    } catch (error) {
      if (!abortController.signal.aborted && !reply.raw.writableEnded) {
        reply.raw.write(
          formatChatSseEvent('chat.run_error', { message: error instanceof Error ? error.message : '聊天流读取失败' }),
        )
      }
    } finally {
      reply.raw.removeListener('close', closeConnection)
      if (!reply.raw.writableEnded) reply.raw.end()
    }
  })

  app.post('/chat/runs/:runId/commands', async (request, reply) => {
    const { runId } = chatRunParamsSchema.parse(request.params)
    const result = await submitChatCommand(runId, request.body)
    return reply.status(202).send(result)
  })
}
