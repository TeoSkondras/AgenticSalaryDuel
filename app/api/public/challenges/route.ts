import { NextRequest, NextResponse } from 'next/server'
import { getChallenges } from '@/lib/db'

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

    const docs = await challenges.find(filter).sort({ index: 1 }).toArray()

    return NextResponse.json({
      challenges: docs.map((c) => ({
        id: c._id?.toString(),
        dayKey: c.dayKey,
        index: c.index,
        status: c.status,
        jobInfo: c.jobInfo,
        promptSnippet: c.prompt.slice(0, 300),
        constraints: {
          maxRounds: c.constraints.maxRounds,
          employerTargets: c.constraints.employerTargets,
          candidateTargets: c.constraints.candidateTargets,
          weights: c.constraints.weights,
        },
        activatedAt: c.activatedAt,
        lockedAt: c.lockedAt,
      })),
    })
  } catch (err) {
    console.error('Get challenges error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
