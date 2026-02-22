#!/usr/bin/env tsx
/**
 * Scrape jobs and select tomorrow's challenges.
 * Run: pnpm tsx scripts/scrape-and-select.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { MongoClient, ObjectId } from 'mongodb'
import { scrapeAll } from '../lib/scrape'
import { selectChallenges } from '../lib/selectChallenges'
import type { JobPosting, Challenge } from '../types'

const MONGODB_URI = process.env.MONGODB_URI || ''
const MONGODB_DB = process.env.MONGODB_DB || 'agenticsalaryduel'

if (!MONGODB_URI) {
  console.error('MONGODB_URI not set')
  process.exit(1)
}

async function main() {
  const client = new MongoClient(MONGODB_URI)
  await client.connect()
  const db = client.db(MONGODB_DB)

  const challenges = db.collection<Challenge>('challenges')
  const jobPostings = db.collection<JobPosting>('jobPostings')

  // Tomorrow's dayKey
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowKey = tomorrow.toISOString().slice(0, 10)

  const existing = await challenges.find({ dayKey: tomorrowKey }).toArray()
  const existingCompanies = existing.map((c) => c.jobInfo.company)

  if (existing.length >= 3) {
    console.log(`Tomorrow (${tomorrowKey}) already has ${existing.length} challenges. Done.`)
    await client.close()
    return
  }

  console.log('Scraping jobs...')
  const jobs = await scrapeAll()
  console.log(`Scraped ${jobs.length} total jobs`)

  // Upsert all scraped jobs
  for (const job of jobs) {
    await jobPostings.updateOne({ externalId: job.externalId }, { $set: job }, { upsert: true })
  }

  const needed = 3 - existing.length
  const selected = selectChallenges(jobs, existingCompanies, needed)

  if (selected.length === 0) {
    console.log('No suitable CS jobs found. Try again later or expand the company list.')
    await client.close()
    return
  }

  for (let i = 0; i < selected.length; i++) {
    const { job, level, constraints, prompt } = selected[i]

    const jobResult = await jobPostings.findOneAndUpdate(
      { externalId: job.externalId },
      { $set: job },
      { upsert: true, returnDocument: 'after' }
    )
    const jobId = jobResult?._id || new ObjectId()

    const challengeDoc: Omit<Challenge, '_id'> = {
      dayKey: tomorrowKey,
      index: existing.length + i,
      jobPostingId: jobId,
      status: 'PENDING',
      jobInfo: {
        company: job.company,
        title: job.title,
        location: job.location,
        url: job.url,
        level,
      },
      prompt,
      constraints,
      createdAt: new Date(),
    }

    const result = await challenges.insertOne(challengeDoc)
    console.log(
      `✓ Challenge ${existing.length + i + 1}: ${job.title} @ ${job.company} [${result.insertedId}]`
    )
  }

  console.log(`\nDone. ${selected.length} challenge(s) prepared for ${tomorrowKey}.`)
  await client.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
