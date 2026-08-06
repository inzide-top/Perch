export type ReviewTextChunk = {
  chunkId: string
  index: number
  text: string
  startOffset: number
  endOffset: number
  hasPreviousContext: boolean
  hasNextContext: boolean
}

type TextUnit = {
  text: string
  startOffset: number
  endOffset: number
}

const separators = ['\n\n', '\n', '。', '！', '？', '；', '. ', '!', '?', ';', '，', ',', '、', ' ', '']

function normalizeInput(input: string) {
  return input.replace(/\r\n?/g, '\n')
}

export function chunkReviewText(
  input: string,
  options: {
    maxChars?: number
    overlapChars?: number
  } = {},
): ReviewTextChunk[] {
  const maxChars = options.maxChars ?? 6000
  const overlapChars = options.overlapChars ?? 400

  if (maxChars <= 0) {
    throw new Error('maxChars 必须大于0')
  }

  if (overlapChars < 0 || overlapChars >= maxChars) {
    throw new Error('overlapChars 必须大于等于 0 且小于 maxChars')
  }

  const normalizedInput = normalizeInput(input)
  if (!normalizedInput.trim()) return []

  const contentMaxChars = maxChars - overlapChars

  // 统一换行符

  // 按空行切段落
  // 如果段落过长，再按中文标点切句子
  // 如果结果过长再按英文标点切
  const textUnits = splitInputUnits(normalizedInput, 0, contentMaxChars, 0)
  const packedUnits = packTextUnits(textUnits, contentMaxChars)

  return packedUnits.map((unit, index, allUnits) => {
    const previousUnit = allUnits[index - 1]
    const previousContext = previousUnit && overlapChars > 0 ? previousUnit.text.slice(-overlapChars) : ''

    const startOffset = previousContext ? unit.startOffset - previousContext.length : unit.startOffset

    const text = previousContext + unit.text

    return {
      chunkId: `review-chunk-${index}-${startOffset}-${unit.endOffset}`,
      index,
      text,
      startOffset,
      endOffset: unit.endOffset,
      hasPreviousContext: previousContext.length > 0,
      hasNextContext: index < allUnits.length - 1 && overlapChars > 0,
    }
  })
}

function splitBySeparator(text: string, startOffset: number, separator: string): TextUnit[] {
  const units: TextUnit[] = []
  let cursor = 0
  while (cursor < text.length) {
    const separatorIndex = text.indexOf(separator, cursor)

    if (separatorIndex === -1) {
      units.push({
        text: text.slice(cursor),
        startOffset: startOffset + cursor,
        endOffset: startOffset + text.length,
      })
      break
    }

    const endOffset = separatorIndex + separator.length

    units.push({
      text: text.slice(cursor, endOffset),
      startOffset: startOffset + cursor,
      endOffset: startOffset + endOffset,
    })

    cursor = endOffset
  }

  return units
}

function splitInputUnits(text: string, startOffset: number, maxChars: number, separatorIndex = 0): TextUnit[] {
  if (text.length <= maxChars) {
    return [
      {
        text,
        startOffset,
        endOffset: startOffset + text.length,
      },
    ]
  }

  const separator = separators[separatorIndex]
  if (separator === '' || separator === undefined) {
    return splitByFixedLength(text, startOffset, maxChars)
  }

  if (!text.includes(separator)) {
    return splitInputUnits(text, startOffset, maxChars, separatorIndex + 1)
  }

  const parts = splitBySeparator(text, startOffset, separator)

  return parts.flatMap((part) => {
    if (part.text.length <= maxChars) return [part]
    return splitInputUnits(part.text, part.startOffset, maxChars, separatorIndex + 1)
  })
}

function splitByFixedLength(text: string, startOffset: number, maxChars: number) {
  const units: TextUnit[] = []

  for (let cursor = 0; cursor < text.length; cursor += maxChars) {
    const end = Math.min(cursor + maxChars, text.length)

    units.push({
      text: text.slice(cursor, end),
      startOffset: startOffset + cursor,
      endOffset: startOffset + end,
    })
  }

  return units
}

function packTextUnits(units: TextUnit[], maxChars: number): TextUnit[] {
  const chunks: TextUnit[] = []
  let currentChunk: TextUnit | null = null

  for (const unit of units) {
    if (!currentChunk) {
      currentChunk = {
        text: unit.text,
        startOffset: unit.startOffset,
        endOffset: unit.endOffset,
      }
      continue
    }

    const mergedLength = currentChunk.text.length + unit.text.length

    if (mergedLength <= maxChars) {
      currentChunk = {
        text: currentChunk.text + unit.text,
        startOffset: currentChunk.startOffset,
        endOffset: unit.endOffset,
      }
      continue
    }

    chunks.push(currentChunk)

    currentChunk = {
      text: unit.text,
      startOffset: unit.startOffset,
      endOffset: unit.endOffset,
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk)
  }
  return chunks
}
