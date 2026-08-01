import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import { requestMetricsLogger } from '../utils/request-metrics'

const connectionString = process.env.DATABASE_URL
const configuredPoolSize = Number(process.env.DATABASE_POOL_SIZE ?? 3)
const configuredSsl = process.env.DATABASE_SSL ?? 'require'

if (!connectionString) {
  throw new Error('DATABASE_URL is required to connect to PostgreSQL')
}

if (!Number.isInteger(configuredPoolSize) || configuredPoolSize < 1) {
  throw new Error('DATABASE_POOL_SIZE must be a positive integer')
}

if (configuredSsl !== 'require' && configuredSsl !== 'disable') {
  throw new Error('DATABASE_SSL must be either require or disable')
}

const queryClient = postgres(connectionString, {
  prepare: false,
  ssl: configuredSsl === 'require' ? 'require' : false,
  max: configuredPoolSize,
  idle_timeout: 20,
  connect_timeout: 10,
})

export const db = drizzle({
  client: queryClient,
  schema,
  logger: requestMetricsLogger,
})

export async function closeDatabase() {
  await queryClient.end({ timeout: 5 })
}
