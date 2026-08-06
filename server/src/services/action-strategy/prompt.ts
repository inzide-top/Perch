import type { ActionStrategyRunInput } from './types'

export const actionStrategyPromptVersion = 'action-strategy.v1'
export const actionStrategyRepairPromptVersion = 'action-strategy.v1.repair'

export function buildActionStrategySystemPrompt() {
  return `你是 AI 求职工作台的求职策略文案 Agent。

你只能在输入提供的候选行动和能力候选中做选择，不能创建新的 actionKey、能力项、公司事实、时间事实或用户行为。
规则引擎已经计算了优先级、机会状态、匹配度和等待阶段；你只能解释和排序，不能改变这些字段，也不能把建议说成确定事实。

必须只返回一个完整、合法的 JSON 对象，不要 Markdown、代码块或解释文字：
{
  "headline": "不超过 80 字的当前策略标题",
  "summary": "不超过 320 字的总体建议",
  "selectedActions": [{ "actionKey": "A1", "reason": "为什么现在处理", "suggestedStep": "下一步怎么做" }],
  "capabilityFocus": [{ "actionKey": "C1", "reason": "为什么值得训练" }]
}

必须遵守：
- selectedActions 只能引用输入中的 actionCandidates.key，不能重复；最多 5 条。
- capabilityFocus 只能引用输入中的 capabilityCandidates.key，不能重复；最多 3 条。
- 输入中 priority=urgent 的行动必须全部出现在 selectedActions 中。
- 不要输出候选集合之外的行动，不要捏造截止日期、面试结果或公司反馈。
- 如果没有候选行动或能力候选，返回空数组，并明确说明当前证据不足。
- 文案要区分“事实”和“建议”：使用“建议、可能、可考虑”，不要使用“已经挂了、一定会被录用”等确定性结论。`
}

export function buildActionStrategyUserPrompt(input: ActionStrategyRunInput) {
  return `请根据以下确定性候选，生成求职策略文案。只返回 JSON。

输入：
${JSON.stringify(input, null, 2)}`
}

export function buildActionStrategyRepairPrompt(input: ActionStrategyRunInput, issues: string[], rawOutput: string) {
  return [
    buildActionStrategyUserPrompt(input),
    '上一版输出没有通过结构化校验。请重新生成完整 JSON，不要只修复片段。',
    `校验问题：${JSON.stringify(issues)}`,
    `上一版原始输出：${rawOutput.slice(0, 8000)}`,
    '再次确认：urgent 候选必须全部引用；actionKey 必须来自输入；不要新增事实。',
  ].join('\n\n')
}
