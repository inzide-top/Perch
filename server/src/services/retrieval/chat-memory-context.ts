import type { ModelProviderMessage } from '../chat/model-provider-adapter'
import type { RetrievalResult } from './retrieval-types'

const maxMemoryContextChars = 7_000

function buildMemoryContext(results: RetrievalResult[]) {
  const sections: string[] = []
  let currentLength = 0

  for (const [index, result] of results.entries()) {
    const section = `历史记忆 ${index + 1}：\n${result.content}`
    if (currentLength + section.length > maxMemoryContextChars) break
    sections.push(section)
    currentLength += section.length
  }

  if (sections.length === 0) return ''

  return `以下内容是系统按语义检索得到的历史对话记忆，只能作为可能相关的背景参考：
- 它可能已经过期或与当前问题无关，必须先判断相关性，不能强行使用。
- 当前用户消息、本轮显式引用和工具返回的最新数据库数据优先级更高。
- 历史记忆不是数据库当前状态的证明，涉及动态数据时仍应调用相应工具。
- 不要向用户暴露“向量、Top-K、相似度、记忆编号”等内部检索实现。

${sections.join('\n\n')}`
}

export function appendChatMemoryContext(messages: ModelProviderMessage[], results: RetrievalResult[]) {
  const memoryContext = buildMemoryContext(results)
  if (!memoryContext) return messages

  const firstMessage = messages[0]
  if (firstMessage?.role === 'system') {
    return [{ ...firstMessage, content: `${firstMessage.content}\n\n${memoryContext}` }, ...messages.slice(1)]
  }

  return [{ role: 'system' as const, content: memoryContext }, ...messages]
}
