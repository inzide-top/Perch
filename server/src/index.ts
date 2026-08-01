import 'dotenv/config'
import { app } from './app'
import { closeDatabase } from './db/client'

const port = Number(process.env.PORT ?? 8787)
const host = process.env.API_HOST ?? '127.0.0.1'

let isShuttingDown = false

async function shutdown(signal: NodeJS.Signals) {
  if (isShuttingDown) return
  isShuttingDown = true

  app.log.info({ signal }, 'Shutting down API')
  await app.close()
  await closeDatabase()
}

process.once('SIGINT', () => {
  void shutdown('SIGINT')
})
process.once('SIGTERM', () => {
  void shutdown('SIGTERM')
})

try {
  await app.listen({
    port,
    host,
  })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
