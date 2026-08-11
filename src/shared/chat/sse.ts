export type ChatSseFrame = {
  event: string
  data: string
}

/**
 * 解析一批可能不完整的 SSE 文本。
 *
 * Fetch Stream 的一次 read() 不保证刚好落在 SSE 事件边界上，所以这里
 * 会把最后一个未结束的片段原样返回给调用方，等待下一次网络数据补齐。
 */
export function parseChatSseFrames(input: string): { frames: ChatSseFrame[]; remainder: string } {
  const normalized = input.replace(/\r\n?/g, '\n')
  const sections = normalized.split('\n\n')
  const remainder = sections.pop() ?? ''

  return {
    frames: sections.map(parseChatSseFrame).filter((frame): frame is ChatSseFrame => frame !== null),
    remainder,
  }
}

/** 解析一个已经完整结束的 SSE 事件；没有 data 的心跳/注释帧会被忽略。 */
export function parseChatSseFrame(frame: string): ChatSseFrame | null {
  let event = 'message'
  const dataLines: string[] = []

  for (const line of frame.replace(/\r\n?/g, '\n').split('\n')) {
    if (!line || line.startsWith(':')) continue

    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim()
      continue
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart())
    }
  }

  if (dataLines.length === 0) return null
  return { event, data: dataLines.join('\n') }
}
