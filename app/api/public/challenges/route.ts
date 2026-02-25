import { NextRequest, NextResponse } from 'next/server'
import { getChallenges } from '@/lib/db'
import { publicConstraints } from '@/lib/constraints'
import { logRouteError } from '@/lib/logger'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const dayKey = searchParams.get('dayKey')

    const challenges = await getChallenges()

    const filter: Record<string, unknown> = {}
    if (dayKey) {
      filter.dayKey = dayKey
    } else {
      // Default to today
      const today = new Date().toISOString().slice(0, 10)
      filter.dayKey = today
    }

    let docs = await challenges.find(filter).sort({ index: 1 }).toArray()

    // Fallback: if no challenges exist for today (seed hasn't run yet), use the most recent day
    let isFallback = false
    if (docs.length === 0 && !dayKey) {
      const mostRecent = await challenges.findOne({}, { sort: { dayKey: -1 } })
      if (mostRecent) {
        docs = await challenges.find({ dayKey: mostRecent.dayKey }).sort({ index: 1 }).toArray()
        isFallback = true
      }
    }

    return NextResponse.json({
      fallback: isFallback,
      challenges: docs.map((c) => ({
        id: c._id?.toString(),
        dayKey: c.dayKey,
        index: c.index,
        status: c.status,
        jobInfo: c.jobInfo,
        promptSnippet: c.prompt.slice(0, 300),
        constraints: {
          ...publicConstraints(c.constraints),
          // Kept for backward compatibility — agents that were built against the old API
          // still read these fields. New agents should use GET /api/agent/sessions/:id
          // and read `myTargets` (role-specific) instead of using both sides' targets.
          employerTargets: c.constraints.employerTargets,
          candidateTargets: c.constraints.candidateTargets,
        },
        activatedAt: c.activatedAt,
        lockedAt: c.lockedAt,
      })),
    })
  } catch (err) {
    logRouteError('GET /api/public/challenges', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
