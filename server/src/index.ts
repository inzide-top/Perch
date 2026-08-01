import 'dotenv/config'
import { app } from './app'

const port = Number(process.env.PORT ?? 8787)

try {
  await app.listen({
    port,
    host: '127.0.0.1',
  })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
