#!/usr/bin/env tsx
/**
 * Seed today's challenges from sample data.
 * Run: pnpm tsx scripts/seed.ts
 */

import { config } from 'dotenv'
// Only load .env.local when running locally (no MONGODB_URI from Railway/host)
if (!process.env.MONGODB_URI) {
  config({ path: '.env.local' })
}
import { MongoClient, ObjectId } from 'mongodb'
import { buildConstraints, buildPrompt, inferLevel } from '../lib/selectChallenges'
import type { JobPosting, Challenge } from '../types'

const MONGODB_URI = process.env.MONGODB_URI || ''
const MONGODB_DB = process.env.MONGODB_DB || 'agenticsalaryduel'

if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Copy .env.local.example to .env.local and fill it in.')
  process.exit(1)
}

const SAMPLE_JOBS: Array<Omit<JobPosting, '_id'>> = [
  {
    source: 'sample',
    externalId: 'sample-stripe-swe-mid',
    company: 'Stripe',
    title: 'Software Engineer, Payments Infrastructure',
    location: 'San Francisco, CA',
    url: 'https://stripe.com/jobs/listing/software-engineer-payments',
    postedAt: new Date(),
    rawData: {},
  },
  {
    source: 'sample',
    externalId: 'sample-openai-ml-senior',
    company: 'OpenAI',
    title: 'Senior ML Engineer, Alignment',
    location: 'San Francisco, CA',
    url: 'https://openai.com/careers/senior-ml-engineer',
    postedAt: new Date(),
    rawData: {},
  },
  {
    source: 'sample',
    externalId: 'sample-vercel-swe-staff',
    company: 'Vercel',
    title: 'Staff Software Engineer, Platform',
    location: 'Remote (US)',
    url: 'https://vercel.com/careers/staff-software-engineer',
    postedAt: new Date(),
    rawData: {},
  },
]

async function main() {
  const client = new MongoClient(MONGODB_URI)
  await client.connect()
  const db = client.db(MONGODB_DB)

  const challenges = db.collection<Challenge>('challenges')
  const jobPostings = db.collection<JobPosting>('jobPostings')

  const today = new Date().toISOString().slice(0, 10)

  // Check if today's challenges already exist
  const existing = await challenges.countDocuments({ dayKey: today })
  if (existing >= 3) {
    console.log(`Today (${today}) already has ${existing} challenges. Nothing to do.`)
    await client.close()
    return
  }

  const needed = 3 - existing
  const toInsert = SAMPLE_JOBS.slice(existing, existing + needed)

  for (let i = 0; i < toInsert.length; i++) {
    const job = toInsert[i]

    // Upsert job posting
    const jobResult = await jobPostings.findOneAndUpdate(
      { externalId: job.externalId },
      { $set: job },
      { upsert: true, returnDocument: 'after' }
    )

    const jobId = jobResult?._id || new ObjectId()
    const level = inferLevel(job.title)
    const constraints = buildConstraints(level)
    const prompt = buildPrompt(job as JobPosting, level, constraints)

    const challengeDoc: Omit<Challenge, '_id'> = {
      dayKey: today,
      index: existing + i,
      jobPostingId: jobId,
      status: 'ACTIVE',
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
      activatedAt: new Date(),
    }

    await challenges.insertOne(challengeDoc)
    console.log(`✓ Created challenge #${existing + i + 1}: ${job.title} @ ${job.company}`)
  }

  console.log(`\nSeed complete. ${needed} challenge(s) created for ${today}.`)
  await client.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
