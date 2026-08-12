import assert from 'node:assert/strict'
import test from 'node:test'
import { chunkChatMemoryTurn } from './chat-memory-chunk'

test('用户或助手文本为空时不生成记忆分块', () => {
  assert.deepEqual(
    chunkChatMemoryTurn({
      userText: '测试问题',
      assistantText: '   ',
    }),
    [],
  )

  assert.deepEqual(
    chunkChatMemoryTurn({
      userText: '   ',
      assistantText: '测试回答',
    }),
    [],
  )
})

test('短回答生成一个带问题上下文的稳定分块', () => {
  const chunks = chunkChatMemoryTurn({
    userText: '我应该如何准备 Vue 面试？',
    assistantText: '建议重点复习响应式原理和组件通信。',
  })

  assert.equal(chunks.length, 1)
  assert.equal(chunks[0]?.index, 0)
  assert.ok(chunks[0]?.content.includes('用户问题：我应该如何准备 Vue 面试？'))
  assert.ok(chunks[0]?.content.includes('助手回答：'))
  assert.ok(chunks[0]?.content.includes('响应式原理和组件通信'))
  assert.match(chunks[0]?.contentHash ?? '', /^[a-f0-9]{64}$/)
})

test('长问题默认保留前 350 字和后 250 字，并省略中间内容', () => {
  const questionHead = '前'.repeat(350)
  const questionMiddle = '中'.repeat(400)
  const questionTail = '后'.repeat(250)

  const chunks = chunkChatMemoryTurn({
    userText: `${questionHead}${questionMiddle}${questionTail}`,
    assistantText: '这是回答。',
  })

  assert.equal(chunks.length, 1)
  assert.ok(chunks[0]?.content.includes(`用户问题：${questionHead}…${questionTail}`))
  assert.ok(!chunks[0]?.content.includes(questionMiddle))
})

test('默认分块扩展到 1600 字后仍为回答保留原有空间', () => {
  const chunks = chunkChatMemoryTurn({
    userText: '问题'.repeat(500),
    assistantText: '回答内容。'.repeat(800),
  })

  assert.ok(chunks.length > 1)
  assert.ok(chunks.every((chunk) => chunk.content.length <= 1600))
})

test('长回答分块后每段都保留问题上下文且不超过最大长度', () => {
  const assistantText = Array.from(
    { length: 20 },
    (_, index) => `第${index + 1}段介绍不同的前端知识点和实际项目经验。`,
  ).join('')

  const chunks = chunkChatMemoryTurn(
    {
      userText: '帮我总结前端能力。',
      assistantText,
    },
    {
      maxChars: 120,
      overlapChars: 20,
      maxQuestionChars: 40,
    },
  )

  assert.ok(chunks.length > 1)

  for (const [index, chunk] of chunks.entries()) {
    assert.equal(chunk.index, index)
    assert.ok(chunk.content.length <= 120)
    assert.ok(chunk.content.includes('用户问题：帮我总结前端能力。'))
  }
})

test('相同输入重复分块会得到相同内容和 Hash', () => {
  const input = {
    userText: '分析我的回答。',
    assistantText: '回答结构清晰，但还需要补充具体的数据和结果。',
  }

  assert.deepEqual(chunkChatMemoryTurn(input), chunkChatMemoryTurn(input))
})

test('不会把内部工具状态写入向量记忆', () => {
  const chunks = chunkChatMemoryTurn({
    userText: '修改意向等级。',
    assistantText: '[系统执行记录：内部工具状态]\n已经将意向等级修改为 S。',
  })

  assert.equal(chunks.length, 1)
  assert.ok(!chunks[0]?.content.includes('系统执行记录'))
  assert.ok(chunks[0]?.content.includes('已经将意向等级修改为 S'))
})
