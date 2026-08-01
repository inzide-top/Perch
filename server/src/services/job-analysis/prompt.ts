import { ZodError } from 'zod'
import type { AgentRunError, JobAnalysisRunInput } from '@/types/opportunity'

export type ValidationRepairContext = {
  validationIssues: AgentRunError['validationIssues']
  invalidFieldValues: string
}

export function buildSystemPrompt() {
  return `你是 PERCH 的 JD-简历匹配分析 Agent。请只基于输入中明确提供的 JD 和简历证据分析；没有证据时必须标记为 missing 或 partial，不能臆测候选人能力。

必须只返回一个完整、合法的 JSON 对象：不要 Markdown、不要代码块、不要解释文字。顶层字段和每个数组对象的必填字段都必须存在；数组可为空。所有出现的文本字段必须是去除首尾空白后的非空文本，绝不能输出空字符串 ""。

以下字段在没有明确证据或内容时可以省略：locationMatch.jobAddress、scoreBreakdown[].evidenceFromJD、scoreBreakdown[].evidenceFromResume、requirementMatches[].resumeEvidence、strengths[].evidenceFromResume、gaps[].evidenceFromResume、resumeSuggestions[].relatedJDText。不要为这些字段输出空字符串。

requirementMatches[].suggestion 必须始终存在：有具体、可执行的改进建议时输出非空文本；没有建议时输出 null；绝不能输出 "" 或省略该字段。

JSON 的字段骨架必须是：
{
  "matchScore": 0,
  "recommendation": "worth_trying",
  "summary": "非空摘要",
  "locationMatch": { "resumeCities": [], "isMatched": false, "impact": "minor", "reason": "非空原因" },
  "scoreBreakdown": [{ "key": "core_requirements", "label": "核心要求", "weight": 20, "score": 0, "reason": "非空原因" }],
  "requirementMatches": [{ "requirement": "非空要求", "requiredLevel": "proficient", "candidateLevel": "familiar", "matchStatus": "partial", "importance": "must_have", "risk": "medium", "suggestion": null }],
  "strengths": [{ "title": "非空标题", "evidenceFromJD": "非空 JD 证据", "level": "low", "reason": "非空原因" }],
  "gaps": [{ "title": "非空标题", "evidenceFromJD": "非空 JD 证据", "level": "high", "reason": "非空原因" }],
  "resumeSuggestions": [{ "targetSection": "skills", "title": "非空标题", "reason": "非空原因", "priority": "medium" }],
  "interviewFocus": [{ "topic": "非空主题", "reason": "非空原因", "difficulty": "medium" }]
}

枚举值必须严格使用以下英文小写值，禁止自行翻译、缩写或改写：
- recommendation：strong_match | worth_trying | risky | not_recommended
- level、risk、priority：high | medium | low
- requiredLevel：expert | proficient | familiar | basic | preferred
- candidateLevel：expert | proficient | familiar | basic | missing
- matchStatus：matched（证据充分满足）| partial（证据部分满足）| missing（无证据或不满足）| overqualified（证据显示能力显著高于岗位要求）
- importance：must_have | nice_to_have
- targetSection：summary | skills | project | experience
- difficulty：basic | medium | advanced
- locationMatch.impact：minor

scoreBreakdown 必须且只能包含下列六个固定 key 各一次；它们在任何行业、岗位中均适用，weight 必须依据该 JD 动态分配且总和恰好为 100：
1. core_requirements：岗位明确的核心专业能力或资格
2. related_experience：与岗位任务直接相关的项目、工作或实践经验
3. seniority_depth：职责复杂度、独立性、影响范围、交付深度或成熟度
4. business_context：行业、业务场景、目标用户或可迁移的领域经验。必须同时检查工作经历中的公司行业，以及项目经历中的项目名称、项目介绍和工作内容；不能只根据公司行业判断
5. bonus_points：JD 的加分项、偏好项或非核心差异化能力
6. job_constraints：城市、到岗形式、身份、语言、证书等岗位约束；城市只作轻量参考

为确保 JSON 能完整结束，必须使用简洁表述：summary、reason、evidence 和 suggestion 各不超过 80 个汉字或 160 个字符；requirementMatches 最多 6 条；strengths、gaps、resumeSuggestions、interviewFocus 各最多 3 条；可选证据字段没有必要时直接省略。

每个 score 都是 0 到 100 的数字；每个 weight 大于 0 且不超过 100。matchScore 与 recommendation 会由服务端依据 scoreBreakdown 重算，你仍须填入合法占位值，但不要让它们影响各维度的独立判断。`
}

export function buildInitialUserPrompt(input: JobAnalysisRunInput) {
  return `请分析以下岗位与候选人简历，并返回完整 JSON。\n\nJD：\n${JSON.stringify(input.opportunity, null, 2)}\n\n简历：\n${JSON.stringify(input.resume, null, 2)}`
}

function extractJsonObject(rawOutput: string) {
  const firstObjectIndex = rawOutput.indexOf('{')
  if (firstObjectIndex < 0) throw new SyntaxError('模型输出中未找到 JSON 对象')

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
      if (depth === 0) return rawOutput.slice(firstObjectIndex, index + 1)
    }
  }

  throw new SyntaxError('模型输出中的 JSON 对象不完整')
}

export function parseModelOutputJson(rawOutput: string) {
  const trimmedOutput = rawOutput.trim()
  const codeBlockMatch = trimmedOutput.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const normalizedOutput = codeBlockMatch?.[1]?.trim() ?? trimmedOutput

  try {
    return JSON.parse(normalizedOutput)
  } catch {
    return JSON.parse(extractJsonObject(normalizedOutput))
  }
}

function getValueAtPath(value: unknown, path: Array<string | number>) {
  return path.reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined

    return (current as Record<string | number, unknown>)[key]
  }, value)
}

export function createValidationRepairContext(rawOutput: string, error: ZodError): ValidationRepairContext {
  let parsedOutput: unknown = rawOutput

  try {
    parsedOutput = JSON.parse(rawOutput)
  } catch {
    // 非法 JSON 没有可定位字段，直接把原始片段作为修复参考。
  }

  const validationIssues = error.issues.map((issue) => ({
    path: issue.path.map((part) => String(part)),
    code: issue.code,
    message: issue.message,
  }))
  const invalidFieldValues = validationIssues.map((issue) => ({
    path: issue.path,
    value: getValueAtPath(parsedOutput, issue.path),
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

export function buildRepairUserPrompt(input: JobAnalysisRunInput, repairContext: ValidationRepairContext) {
  return [
    buildInitialUserPrompt(input),
    '你上一次输出未通过结构化校验。',
    `必须只返回一个完整、合法的 JSON 对象：
- 不要 Markdown
- 不要代码块
- 不要解释文字
- 不要只返回修复字段
- 必须保留所有必填字段与正确的分析语义
- 没有内容的可选文本字段必须省略，不能保留为空字符串
- suggestion 必须为非空文本或 null，且不能省略
- scoreBreakdown 必须包含六个固定维度各一次，weight 总和必须为 100
- 上一次输出可能被截断：必须重新生成一个更精简的完整对象，不能续写原输出
- summary、reason、evidence 和 suggestion 各不超过 80 个汉字或 160 个字符；requirementMatches 最多 6 条；strengths、gaps、resumeSuggestions、interviewFocus 各最多 3 条`,
    `以下字段未通过校验：
${JSON.stringify(repairContext.validationIssues)}`,
    `这些字段在上一版输出中的原始值：
${repairContext.invalidFieldValues}`,
    '请在保留正确分析语义的前提下，修复上述字段，并重新输出完整 JSON。',
  ].join('\n\n')
}

export function toValidationError(rawOutput: string, error: ZodError): AgentRunError {
  const repairContext = createValidationRepairContext(rawOutput, error)

  return {
    code: 'structured_output_validation_failed',
    message: '模型输出未通过 JobAnalysis Zod 校验',
    retryable: true,
    validationIssues: repairContext.validationIssues,
  }
}
