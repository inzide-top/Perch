import { capabilityJdSignalRepository } from '../repositories/capability-jd-signal.repository'
import { getConfiguredCapabilityJdSignalIndexer } from './capability-jd-signal-indexer'

const compensationIntervalMs = 15 * 60 * 1_000
const compensationBatchSize = 25

type CompensationWorkerLogger = {
  info: (context: Record<string, unknown>, message: string) => void
  error: (context: Record<string, unknown>, message: string) => void
}

export function startCapabilityJdSignalCompensationWorker(logger: CompensationWorkerLogger) {
  let indexer
  try {
    indexer = getConfiguredCapabilityJdSignalIndexer()
  } catch (error) {
    logger.error({ error }, 'Capability JD signal compensation is disabled because Embedding configuration is invalid')
    return async () => undefined
  }
  if (!indexer) {
    logger.info({}, 'Capability JD signal compensation is disabled because Embedding is not configured')
    return async () => undefined
  }

  const controller = new AbortController()
  let timer: NodeJS.Timeout | null = null
  let activeScan: Promise<void> | null = null

  const run = async () => {
    let indexedCount = 0
    let failedCount = 0
    try {
      const analysisIds = await capabilityJdSignalRepository.listUnindexedCompletedAnalysisIds({
        limit: compensationBatchSize,
        embeddingModel: indexer.embeddingModel,
      })
      for (const analysisId of analysisIds) {
        if (controller.signal.aborted) break
        try {
          const result = await indexer.indexCompletedAnalysisFamily(analysisId, controller.signal)
          indexedCount += result.indexedCount
        } catch (error) {
          failedCount += 1
          if (!controller.signal.aborted) {
            logger.error({ error, analysisId }, 'Capability JD signal compensation candidate failed')
          }
        }
      }
      if (analysisIds.length > 0) {
        logger.info(
          { examinedCount: analysisIds.length, indexedCount, failedCount },
          'Capability JD signal compensation scan completed',
        )
      }
    } catch (error) {
      if (!controller.signal.aborted) logger.error({ error }, 'Capability JD signal compensation scan failed')
    } finally {
      activeScan = null
      if (!controller.signal.aborted) {
        timer = setTimeout(schedule, compensationIntervalMs)
        timer.unref()
      }
    }
  }

  const schedule = () => {
    if (controller.signal.aborted || activeScan) return
    activeScan = run()
  }

  schedule()

  return async () => {
    controller.abort('server_shutdown')
    if (timer) clearTimeout(timer)
    await activeScan
  }
}
