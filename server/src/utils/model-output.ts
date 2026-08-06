function extractJsonObject(rawOutput: string) {
  const firstObjectIndex = rawOutput.indexOf('{')
  if (firstObjectIndex < 0) {
    throw new SyntaxError('模型输出中未找到 JSON 对象')
  }

  let depth = 0
  let isInsideString = false
  let isEscaped = false

  for (let index = firstObjectIndex; index < rawOutput.length; index += 1) {
    const character = rawOutput[index]

    if (isInsideString) {
      if (isEscaped) {
        isEscaped = false
      } else if (character === '\\') {
        isEscaped = true
      } else if (character === '"') {
        isInsideString = false
      }

      continue
    }

    if (character === '"') {
      isInsideString = true
    } else if (character === '{') {
      depth += 1
    } else if (character === '}') {
      depth -= 1

      if (depth === 0) {
        return rawOutput.slice(firstObjectIndex, index + 1)
      }
    }
  }

  throw new SyntaxError('模型输出中的 JSON 对象不完整')
}

export function parseModelOutputJson(rawOutput: string): unknown {
  const trimmedOutput = rawOutput.trim()
  const codeBlockMatch = trimmedOutput.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const normalizedOutput = codeBlockMatch?.[1]?.trim() ?? trimmedOutput

  try {
    return JSON.parse(normalizedOutput)
  } catch {
    return JSON.parse(extractJsonObject(normalizedOutput))
  }
}
