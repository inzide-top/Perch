import { chatMemoryRepository } from '../../repositories/chat-memory.repository'
import { ChatMemoryCompensationScanner } from './chat-memory-compensation'
import { getConfiguredChatMemoryIndexer } from './chat-memory-environment'

const compensationIntervalMs = 15 * 60 * 1_000

type ChatMemoryCompensationWorkerLogger = {
  info: (context: Record<string, unknown>, message: string) => void
  error: (context: Record<string, unknown>, message: string) => void
}

export function startChatMemoryCompensationWorker(logger: ChatMemoryCompensationWorkerLogger) {
  let indexer
  try {
    indexer = getConfiguredChatMemoryIndexer()
  } catch (error) {
    logger.error({ error }, 'Chat memory compensation is disabled because Embedding configuration is invalid')
    return async () => undefined
  }

  if (!indexer) {
    logger.info({}, 'Chat memory compensation is disabled because Embedding is not configured')
    return async () => undefined
  }

  const controller = new AbortController()
  const scanner = new ChatMemoryCompensationScanner({
    repository: chatMemoryRepository,
    indexer,
    logError: (error, context) => {
      logger.error({ error, ...context }, 'Chat memory compensation candidate failed')
    },
  })
  let timer: NodeJS.Timeout | null = null
  let activeScan: Promise<void> | null = null

  const schedule = () => {
    if (controller.signal.aborted || activeScan) return
    activeScan = run()
  }

  const run = async () => {
    try {
      const result = await scanner.scanOnce(controller.signal)
      if (result.examinedCount > 0) {
        logger.info(result, 'Chat memory compensation scan completed')
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        logger.error({ error }, 'Chat memory compensation scan failed')
      }
    } finally {
      activeScan = null
      if (!controller.signal.aborted) {
        timer = setTimeout(schedule, compensationIntervalMs)
        timer.unref()
      }
    }
  }

  schedule()

  return async () => {
    controller.abort('server_shutdown')
    if (timer) clearTimeout(timer)
    await activeScan
  }
}
