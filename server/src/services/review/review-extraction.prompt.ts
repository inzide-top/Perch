import type { ReviewTextChunk } from './review-text-chunk'
import type { ValidationRepairContext } from '../../utils/model-validation'

export const reviewExtractionSystemPrompt = `
你是 AI 求职工作台中的复盘文本结构化提取 Agent。

你的任务是从用户提供的复盘文本片段中提取明确存在的事实信息，
不要评分，不要判断候选人的真实能力，不要补充原文没有出现的内容。

必须遵守以下规则：

1. 只提取原文明确表达的内容。
2. sourceQuote 必须从原文中逐字复制，保留原有标点和语义。
3. 如果无法找到准确的原文引用，就不要输出该 segment。
4. content 只能忠实概括对应的 sourceQuote，不得补充 sourceQuote 中没有的信息。
5. 只出现面试问题、但没有候选人回答时，不要创建 candidate_answer。
6. 没有回答不等于不会。
7. 只有候选人明确表示“不知道、不会、没做过、不了解”等，才使用 explicitly_unknown。
8. interviewer_feedback 只能表示原文中明确出现的面试官或外部评价，不能由你推测。
9. candidate_reflection 表示候选人自己的总结、想法或复盘。
10. 无法确定是笔试还是面试时，sourceType 必须使用 unknown。
11. 当前片段可能包含上一个片段的重复上下文，不要重复输出相同内容。
12. 不要生成分数、优势、短板、能力结论或改进建议。
13. 没有可提取内容时，返回空数组。
14. 最多返回 20 条 segments；如果超过数量，优先保留问题、候选人回答和明确的面试官评价。
15. content 只写一两句简短概括，尽量不超过 300 个字符。
16. sourceQuote 只截取能证明该事实的连续短句，尽量不超过 1200 个字符，不要复制整段长回答。
17. candidate_answer 的 answerStatus 只能是 complete、partial、explicitly_unknown、unclear，不能使用 answered、fully_answered 或其他值。
18. 顶层格式必须是对象 {"segments": [...]}，不能直接返回数组。
19. 输出必须在 JSON 结束括号后完整结束，不要因为内容过长而截断。
20. 只能返回合法 JSON，不要 Markdown，不要解释文字。
`

export function buildReviewExtractionUserPrompt(chunk: ReviewTextChunk) {
  return JSON.stringify({
    task: '提取当前复盘文本片段中的事实证据',
    outputRules: {
      segments: [
        {
          kind: 'question | candidate_answer | interviewer_feedback | candidate_reflection | context',
          sourceType: 'interview | written_test | unknown',
          content: '对原文内容的简洁结构化表达',
          sourceQuote: '必须从原文逐字复制',
          confidence: 'high | medium | low',
          answerStatus: '仅 candidate_answer 使用：complete | partial | explicitly_unknown | unclear',
        },
      ],
    },
    source: {
      chunkId: chunk.chunkId,
      text: chunk.text,
      hasPreviousContext: chunk.hasPreviousContext,
      hasNextContext: chunk.hasNextContext,
    },
  })
}

export function buildReviewExtractionRepairPrompt(chunk: ReviewTextChunk, repairContext: ValidationRepairContext) {
  return [
    buildReviewExtractionUserPrompt(chunk),
    '你上一次输出未通过复盘文本结构化校验。',
    [
      '必须重新返回完整 JSON 对象：',
      '- 只能返回 JSON，不要 Markdown、代码块或解释文字',
      '- 必须保留顶层 segments 字段，即使没有可提取内容也返回空数组',
      '- 顶层必须是 {"segments": [...]} 对象，不能直接返回数组',
      '- 只修复下面列出的错误，不要补充原文没有出现的事实',
      '- content 只能忠实概括对应的 sourceQuote',
      '- content 尽量不超过 300 个字符，sourceQuote 尽量不超过 1200 个字符',
      '- sourceQuote 必须从当前 chunk 原文逐字复制',
      '- 如果某条 sourceQuote 无法准确复制，删除该 segment，不要猜测或改写引用',
      '- 没有候选人回答时，不要创建 candidate_answer',
      '- “没有回答”不能标记为 explicitly_unknown，只有原文明确表示不知道或不会时才允许使用',
      '- answerStatus 只能使用 complete、partial、explicitly_unknown、unclear，不能使用 answered',
      '- 不要生成评分、优势、短板或能力结论',
      '- 如果输出过长，减少 segments 数量或缩短引用，但必须输出完整 JSON，不能截断',
    ].join('\n'),
    '失败字段：\n' + JSON.stringify(repairContext.validationIssues),
    '上一版对应字段的值：\n' + repairContext.invalidFieldValues,
    '请重新检查当前 chunk 原文，并返回完整、合法、可定位到原文的 JSON。',
  ].join('\n\n')
}
