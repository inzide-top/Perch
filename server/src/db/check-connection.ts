import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db } from './client'

async function checkConnection() {
  await db.execute(sql`select 1`)
  console.log('PostgreSQL connection verified')
}

try {
  await checkConnection()
} catch (error) {
  console.error('PostgreSQL connection failed', error)
  process.exitCode = 1
}

