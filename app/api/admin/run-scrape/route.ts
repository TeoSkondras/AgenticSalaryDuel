import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminToken } from '@/lib/auth'
import { scrapeAll } from '@/lib/scrape'
import { selectChallenges } from '@/lib/selectChallenges'
import { getChallenges, getJobPostings } from '@/lib/db'
import { logRouteError } from '@/lib/logger'

export async function POST(req: NextRequest) {
  if (!verifyAdminToken(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Tomorrow's dayKey
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowKey = tomorrow.toISOString().slice(0, 10)

    const [challenges, jobPostings] = await Promise.all([getChallenges(), getJobPostings()])

    // Check existing tomorrow challenges
    const existing = await challenges.find({ dayKey: tomorrowKey }).toArray()
    const existingCompanies = existing.map((c) => c.jobInfo.company)

    if (existing.length >= 3) {
      return NextResponse.json({
        message: 'Tomorrow already has 3 challenges',
        dayKey: tomorrowKey,
        existing: existing.length,
      })
    }

    // Scrape
    console.log('Starting scrape...')
    const jobs = await scrapeAll()
    console.log(`Scraped ${jobs.length} total jobs`)

    // Store scraped jobs
    for (const job of jobs) {
      await jobPostings.updateOne(
        { externalId: job.externalId },
        { $set: job },
        { upsert: true }
      )
    }

    // Select 3 - existing.length challenges
    const needed = 3 - existing.length
    const selected = selectChallenges(jobs, existingCompanies, needed)

    const inserted: string[] = []

    for (let i = 0; i < selected.length; i++) {
      const { job, level, constraints, prompt } = selected[i]

      // Upsert job posting
      const jobResult = await jobPostings.findOneAndUpdate(
        { externalId: job.externalId },
        { $set: job },
        { upsert: true, returnDocument: 'after' }
      )

      const jobId = jobResult?._id

      const challengeDoc = {
        dayKey: tomorrowKey,
        index: existing.length + i,
        jobPostingId: jobId!,
        status: 'PENDING' as const,
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
      inserted.push(result.insertedId.toString())
    }

    return NextResponse.json({
      message: 'Scrape complete',
      dayKey: tomorrowKey,
      jobsScraped: jobs.length,
      challengesInserted: inserted.length,
      challengeIds: inserted,
    })
  } catch (err) {
    logRouteError('POST /api/admin/run-scrape', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
