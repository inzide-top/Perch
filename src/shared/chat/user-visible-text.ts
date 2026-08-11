const leakedInternalToolContextPattern = /^\s*\[(?:系统执行记录|系统验证记录)[：:][\s\S]*?\]\s*/u

/** 兼容清理旧版本曾误写进助手正文的内部工具状态，不改动数据库原记录。 */
export function toUserVisibleChatText(text: string) {
  return text.replace(leakedInternalToolContextPattern, '')
}
