import assert from 'node:assert/strict'
import test from 'node:test'
import { chunkReviewText } from './review-text-chunk'

test('空文本返回空数组', () => {
  assert.deepEqual(chunkReviewText(' \n\t'), [])
})

test('短文本保持原文和完整 offset', () => {
  const text = '我做过前端开发。'

  const chunks = chunkReviewText(text, {
    maxChars: 100,
    overlapChars: 10,
  })

  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].text, text)
  assert.equal(chunks[0].startOffset, 0)
  assert.equal(chunks[0].endOffset, text.length)
  assert.equal(chunks[0].hasPreviousContext, false)
  assert.equal(chunks[0].hasNextContext, false)
})

test('多个句子会按照 maxChars 合并并添加 overlap', () => {
  const chunks = chunkReviewText('第一段内容。第二段内容。第三段内容。', {
    maxChars: 12,
    overlapChars: 3,
  })

  assert.equal(chunks.length, 3)

  assert.equal(chunks[0].text, '第一段内容。')
  assert.equal(chunks[0].startOffset, 0)
  assert.equal(chunks[0].endOffset, 6)

  assert.equal(chunks[1].text, '内容。第二段内容。')
  assert.equal(chunks[1].startOffset, 3)
  assert.equal(chunks[1].endOffset, 12)
  assert.equal(chunks[1].hasPreviousContext, true)

  assert.equal(chunks[2].text, '内容。第三段内容。')
  assert.equal(chunks[2].startOffset, 9)
  assert.equal(chunks[2].endOffset, 18)
  assert.equal(chunks[2].hasNextContext, false)
})

test('没有标点的长文本会使用固定长度切分', () => {
  const chunks = chunkReviewText('abcdefghijklmnop', {
    maxChars: 10,
    overlapChars: 2,
  })

  assert.equal(chunks.length, 2)
  assert.equal(chunks[0].text, 'abcdefgh')
  assert.equal(chunks[1].text, 'ghijklmnop')
  assert.equal(chunks[1].startOffset, 6)
  assert.equal(chunks[1].endOffset, 16)
})

test('最终 chunk 长度不会超过 maxChars', () => {
  const chunks = chunkReviewText('这是一段很长的复盘内容。'.repeat(100), {
    maxChars: 50,
    overlapChars: 10,
  })

  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= 50)
  }
})

test('chunkId 基于位置稳定生成', () => {
  const text = '第一段内容。第二段内容。'

  const first = chunkReviewText(text, {
    maxChars: 10,
    overlapChars: 2,
  })

  const second = chunkReviewText(text, {
    maxChars: 10,
    overlapChars: 2,
  })

  assert.deepEqual(
    first.map((chunk) => chunk.chunkId),
    second.map((chunk) => chunk.chunkId),
  )
})
