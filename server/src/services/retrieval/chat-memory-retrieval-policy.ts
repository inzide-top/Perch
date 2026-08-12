const exactAcknowledgements = new Set(['好', '好的', '可以', '行', '没问题', '确认', '确定', '同意', 'ok', 'okay'])

function normalizeAcknowledgement(text: string) {
  return text
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('zh-CN')
    .replace(/[。.!！]+$/u, '')
    .trim()
}

/**
 * 只跳过确定不需要历史语义的请求。自然语言意图不明确时仍执行检索，
 * 避免为了节省一次查询而误伤真正依赖历史上下文的问题。
 */
export function shouldRetrieveChatMemory(input: { userText: string; isContinuation: boolean }) {
  if (input.isContinuation) return false
  return !exactAcknowledgements.has(normalizeAcknowledgement(input.userText))
}
