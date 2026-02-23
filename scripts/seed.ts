#!/usr/bin/env tsx
/**
 * Seed today's challenges from a rotating sample pool.
 *
 * Usage:
 *   pnpm seed            — create today's challenges if none exist
 *   pnpm seed -- --force — delete today's challenges and recreate fresh ones
 *
 * Selection is deterministic per day (same 3 companies for a given date) but
 * rotates across days so each day gets different challenges.
 */

import { config } from 'dotenv'
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

// A diverse pool of sample jobs. 3 are picked per day using a date-based rotation
// so different days surface different challenges.
const JOB_POOL: Array<Omit<JobPosting, '_id'>> = [
  {
    source: 'sample', externalId: 'sample-stripe-swe-mid',
    company: 'Stripe', title: 'Software Engineer, Payments Infrastructure',
    location: 'San Francisco, CA', url: 'https://stripe.com/jobs',
    postedAt: new Date(), rawData: {},
  },
  {
    source: 'sample', externalId: 'sample-openai-ml-senior',
    company: 'OpenAI', title: 'Senior ML Engineer, Alignment',
    location: 'San Francisco, CA', url: 'https://openai.com/careers',
    postedAt: new Date(), rawData: {},
  },
  {
    source: 'sample', externalId: 'sample-vercel-swe-staff',
    company: 'Vercel', title: 'Staff Software Engineer, Platform',
    location: 'Remote (US)', url: 'https://vercel.com/careers',
    postedAt: new Date(), rawData: {},
  },
  {
    source: 'sample', externalId: 'sample-anthropic-research-senior',
    company: 'Anthropic', title: 'Senior Research Engineer, Safety',
    location: 'San Francisco, CA', url: 'https://anthropic.com/careers',
    postedAt: new Date(), rawData: {},
  },
  {
    source: 'sample', externalId: 'sample-figma-swe-mid',
    company: 'Figma', title: 'Software Engineer, Editor',
    location: 'San Francisco, CA', url: 'https://figma.com/careers',
    postedAt: new Date(), rawData: {},
  },
  {
    source: 'sample', externalId: 'sample-notion-backend-senior',
    company: 'Notion', title: 'Senior Backend Engineer, Data',
    location: 'San Francisco, CA', url: 'https://notion.so/careers',
    postedAt: new Date(), rawData: {},
  },
  {
    source: 'sample', externalId: 'sample-linear-swe-staff',
    company: 'Linear', title: 'Staff Engineer, Infrastructure',
    location: 'Remote', url: 'https://linear.app/careers',
    postedAt: new Date(), rawData: {},
  },
  {
    source: 'sample', externalId: 'sample-discord-swe-mid',
    company: 'Discord', title: 'Software Engineer, Messaging',
    location: 'San Francisco, CA', url: 'https://discord.com/careers',
    postedAt: new Date(), rawData: {},
  },
  {
    source: 'sample', externalId: 'sample-cloudflare-sre-senior',
    company: 'Cloudflare', title: 'Senior Site Reliability Engineer',
    location: 'Remote (US)', url: 'https://cloudflare.com/careers',
    postedAt: new Date(), rawData: {},
  },
  {
    source: 'sample', externalId: 'sample-airbnb-swe-mid',
    company: 'Airbnb', title: 'Software Engineer, Fullstack',
    location: 'San Francisco, CA', url: 'https://careers.airbnb.com',
    postedAt: new Date(), rawData: {},
  },
  {
    source: 'sample', externalId: 'sample-shopify-swe-senior',
    company: 'Shopify', title: 'Senior Software Developer, Storefront',
    location: 'Remote', url: 'https://shopify.com/careers',
    postedAt: new Date(), rawData: {},
  },
  {
    source: 'sample', externalId: 'sample-spotify-ml-senior',
    company: 'Spotify', title: 'Senior Machine Learning Engineer, Recommendations',
    location: 'New York, NY', url: 'https://lifeatspotify.com',
    postedAt: new Date(), rawData: {},
  },
  {
    source: 'sample', externalId: 'sample-netflix-swe-senior',
    company: 'Netflix', title: 'Senior Software Engineer, Streaming',
    location: 'Los Gatos, CA', url: 'https://jobs.netflix.com',
    postedAt: new Date(), rawData: {},
  },
  {
    source: 'sample', externalId: 'sample-databricks-swe-staff',
    company: 'Databricks', title: 'Staff Software Engineer, Platform',
    location: 'San Francisco, CA', url: 'https://databricks.com/careers',
    postedAt: new Date(), rawData: {},
  },
  {
    source: 'sample', externalId: 'sample-scale-ai-ml-mid',
    company: 'Scale AI', title: 'Machine Learning Engineer, Core',
    location: 'San Francisco, CA', url: 'https://scale.com/careers',
    postedAt: new Date(), rawData: {},
  },
]

/**
 * Deterministic shuffle seeded by the date string.
 * Same day → same order; different day → different order.
 */
function seededShuffle<T>(arr: T[], seed: string): T[] {
  // Simple hash of the seed string
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0
  }
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    h = (Math.imul(h ^ (h >>> 16), 0x45d9f3b)) | 0
    const j = Math.abs(h) % (i + 1)
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

async function main() {
  const force = process.argv.includes('--force')
  const client = new MongoClient(MONGODB_URI)
  await client.connect()
  const db = client.db(MONGODB_DB)

  const challenges = db.collection<Challenge>('challenges')
  const jobPostings = db.collection<JobPosting>('jobPostings')

  const now = new Date()
  const today = now.toISOString().slice(0, 10)

  // Lock ACTIVE challenges from any previous day (handles the case where rollover didn't run)
  const lockResult = await challenges.updateMany(
    { status: 'ACTIVE', dayKey: { $lt: today } },
    { $set: { status: 'LOCKED', lockedAt: now } }
  )
  if (lockResult.modifiedCount > 0) {
    console.log(`Locked ${lockResult.modifiedCount} stale challenge(s) from previous days.`)
  }

  const existing = await challenges.countDocuments({ dayKey: today })

  if (existing >= 3 && !force) {
    console.log(`Today (${today}) already has ${existing} challenges. Use --force to replace them.`)
    await client.close()
    return
  }

  if (existing > 0 && force) {
    const deleted = await challenges.deleteMany({ dayKey: today })
    console.log(`--force: deleted ${deleted.deletedCount} existing challenge(s) for ${today}.`)
  }

  // Pick 3 unique-company jobs using today as the shuffle seed
  const shuffled = seededShuffle(JOB_POOL, today)
  const selected: typeof JOB_POOL = []
  const usedCompanies = new Set<string>()
  for (const job of shuffled) {
    if (selected.length >= 3) break
    if (usedCompanies.has(job.company)) continue
    usedCompanies.add(job.company)
    selected.push(job)
  }

  for (let i = 0; i < selected.length; i++) {
    const job = selected[i]

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
      index: i,
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
      createdAt: now,
      activatedAt: now,
    }

    await challenges.insertOne(challengeDoc)
    console.log(`✓ Challenge ${i + 1}: ${job.title} @ ${job.company} (${level})`)
  }

  console.log(`\nDone. 3 challenges active for ${today}.`)
  await client.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
