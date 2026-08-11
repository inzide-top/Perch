import { toUserVisibleChatText } from '@/shared/chat/user-visible-text'
import { chunkReviewText } from '../review/review-text-chunk'
import { createHash } from 'node:crypto'

export type ChatMemoryTurnInput = {
  userText: string
  assistantText: string
}

export type ChatMemoryChunk = {
  index: number
  content: string
  contentHash: string
}

function truncateText(text: string, maxChars: number) {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars - 1)}…`
}

function createContentHash(content: string) {
  return createHash('sha256').update(content).digest('hex')
}

export function chunkChatMemoryTurn(
  input: ChatMemoryTurnInput,
  options: {
    maxChars?: number
    overlapChars?: number
    maxQuestionChars?: number
  } = {},
): ChatMemoryChunk[] {
  const maxChars = options.maxChars ?? 1400
  const overlapChars = options.overlapChars ?? 160
  const maxQuestionChars = options.maxQuestionChars ?? 400

  const userText = input.userText.trim()
  const assistantText = toUserVisibleChatText(input.assistantText).trim()

  if (!userText || !assistantText) return []

  const question = truncateText(userText, maxQuestionChars)
  const prefix = `用户问题：${question}\n\n助手回答：\n`

  const answerMaxChars = maxChars - prefix.length

  if (answerMaxChars <= overlapChars) {
    throw new Error('问题上下文过长，无法为回答分块保留有效空间')
  }

  const answerChunks = chunkReviewText(assistantText, {
    maxChars: answerMaxChars,
    overlapChars,
  })
  return answerChunks.map((chunk, index) => {
    const content = `${prefix}${chunk.text}`

    return {
      index,
      content,
      contentHash: createContentHash(content),
    }
  })
}
