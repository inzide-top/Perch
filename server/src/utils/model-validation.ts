import type { ZodError } from 'zod'
import { parseModelOutputJson } from './model-output'

export type ValidationRepairContext = {
  validationIssues: Array<{
    path: Array<string | number>
    code: string
    message: string
    receivedValue?: unknown
  }>
  invalidFieldValues: string
}

function getValueAtPath(value: unknown, path: Array<string | number>) {
  return path.reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined

    return (current as Record<string | number, unknown>)[key]
  }, value)
}

/** 把 Zod 错误转换成可序列化、可反馈给模型的最小修复上下文。 */
export function createValidationRepairContext(rawOutput: string, error: ZodError): ValidationRepairContext {
  let parsedOutput: unknown = rawOutput

  try {
    parsedOutput = parseModelOutputJson(rawOutput)
  } catch {
    // 非法 JSON 没有可定位字段，保留原始字符串供修复参考。
  }

  const validationIssues = error.issues.map((issue) => {
    const path = issue.path.map((part) => String(part))
    const receivedValue = getValueAtPath(parsedOutput, path)

    return {
      path,
      code: issue.code,
      message: issue.message,
      ...(receivedValue === undefined ? {} : { receivedValue }),
    }
  })
  const invalidFieldValues = validationIssues.map((issue) => ({
    path: issue.path,
    value: issue.receivedValue,
  }))

  return {
    validationIssues,
    invalidFieldValues: JSON.stringify(invalidFieldValues).slice(0, 8_000),
  }
}

export function createJsonSyntaxRepairContext(rawOutput: string, error: unknown): ValidationRepairContext {
  return {
    validationIssues: [
      {
        path: [],
        code: 'invalid_json',
        message: error instanceof Error ? error.message : '模型输出不是合法 JSON',
      },
    ],
    invalidFieldValues: JSON.stringify([{ path: [], value: rawOutput.slice(0, 8_000) }]),
  }
}
