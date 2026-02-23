#!/usr/bin/env tsx
/**
 * Wipes sessions, moves, scores, and agents — challenges are untouched.
 * Run: pnpm tsx scripts/reset-db.ts
 *
 * Pass --yes to skip the confirmation prompt.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createInterface } from 'readline'
import { getDb } from '@/lib/db'

const COLLECTIONS_TO_WIPE = ['sessions', 'moves', 'scores', 'agents'] as const

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase() === 'y')
    })
  })
}

async function main() {
  const skipConfirm = process.argv.includes('--yes')

  const db = await getDb()
  const dbName = db.databaseName

  console.log(`\nTarget database: ${dbName}`)
  console.log(`Collections to wipe: ${COLLECTIONS_TO_WIPE.join(', ')}`)
  console.log('Challenges will NOT be touched.\n')

  if (!skipConfirm) {
    const ok = await confirm('Are you sure? This cannot be undone. (y/N) ')
    if (!ok) {
      console.log('Aborted.')
      process.exit(0)
    }
  }

  for (const name of COLLECTIONS_TO_WIPE) {
    const result = await db.collection(name).deleteMany({})
    console.log(`  ${name}: deleted ${result.deletedCount} document(s)`)
  }

  console.log('\nDone. Challenges are intact.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Reset failed:', err.message)
  process.exit(1)
})
