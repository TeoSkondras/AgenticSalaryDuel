#!/usr/bin/env tsx
/**
 * Standalone rollover runner.
 * Locks yesterday's challenges, activates today's PENDING ones.
 * Run: pnpm tsx scripts/rollover.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { MongoClient } from 'mongodb'

const MONGODB_URI = process.env.MONGODB_URI || ''
const MONGODB_DB = process.env.MONGODB_DB || 'agenticsalaryduel'

if (!MONGODB_URI) {
  console.error('MONGODB_URI not set')
  process.exit(1)
}

function getDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

async function main() {
  const client = new MongoClient(MONGODB_URI)
  await client.connect()
  const db = client.db(MONGODB_DB)
  const challenges = db.collection('challenges')

  const now = new Date()
  const today = getDayKey(now)

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayKey = getDayKey(yesterday)

  const lockResult = await challenges.updateMany(
    { dayKey: yesterdayKey, status: 'ACTIVE' },
    { $set: { status: 'LOCKED', lockedAt: now } }
  )

  const activateResult = await challenges.updateMany(
    { dayKey: today, status: 'PENDING' },
    { $set: { status: 'ACTIVE', activatedAt: now } }
  )

  console.log(`Locked ${lockResult.modifiedCount} challenges from ${yesterdayKey}`)
  console.log(`Activated ${activateResult.modifiedCount} challenges for ${today}`)

  await client.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
