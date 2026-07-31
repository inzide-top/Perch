import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL is required to connect to PostgreSQL')
}

const queryClient = postgres(connectionString, {
  prepare: false,
  ssl: 'require',
})

export const db = drizzle({
  client: queryClient,
  schema,
})
