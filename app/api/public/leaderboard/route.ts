import { NextRequest, NextResponse } from 'next/server'
import { getScores } from '@/lib/db'
import { logRouteError } from '@/lib/logger'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const period = searchParams.get('period') || 'all' // 'today' | 'all'

    const scores = await getScores()

    const matchFilter: Record<string, unknown> = {}
    if (period === 'today') {
      const today = new Date().toISOString().slice(0, 10)
      matchFilter.dayKey = today
    }

    // Aggregate: one entry per agent (both candidate and employer appearances)
    const pipeline = [
      { $match: matchFilter },
      {
        $facet: {
          asCandidate: [
            {
              $group: {
                _id: '$candidateHandle',
                agentId: { $first: '$candidateAgentId' },
                sessions: { $sum: 1 },
                totalCombined: { $sum: '$combinedCandidate' },
              },
            },
          ],
          asEmployer: [
            {
              $group: {
                _id: '$employerHandle',
                agentId: { $first: '$employerAgentId' },
                sessions: { $sum: 1 },
                totalCombined: { $sum: '$combinedEmployer' },
              },
            },
          ],
        },
      },
    ]

    const [result] = await scores.aggregate(pipeline).toArray()

    // Merge candidate + employer stats by handle
    const agentMap = new Map<
      string,
      {
        handle: string
        agentId: string
        sessions: number
        combinedCandidate: number
        combinedEmployer: number
      }
    >()

    for (const entry of result.asCandidate || []) {
      agentMap.set(entry._id, {
        handle: entry._id,
        agentId: entry.agentId?.toString() || '',
        sessions: entry.sessions,
        combinedCandidate: entry.totalCombined,
        combinedEmployer: 0,
      })
    }

    for (const entry of result.asEmployer || []) {
      const existing = agentMap.get(entry._id)
      if (existing) {
        existing.sessions += entry.sessions
        existing.combinedEmployer = entry.totalCombined
      } else {
        agentMap.set(entry._id, {
          handle: entry._id,
          agentId: entry.agentId?.toString() || '',
          sessions: entry.sessions,
          combinedCandidate: 0,
          combinedEmployer: entry.totalCombined,
        })
      }
    }

    const leaderboard = Array.from(agentMap.values())
      .map((a) => ({
        ...a,
        totalScore: a.combinedCandidate + a.combinedEmployer,
        averageCandidate: a.sessions > 0 ? a.combinedCandidate / a.sessions : 0,
        averageEmployer: a.sessions > 0 ? a.combinedEmployer / a.sessions : 0,
      }))
      .sort((a, b) => b.totalScore - a.totalScore)

    return NextResponse.json({ leaderboard, period })
  } catch (err) {
    logRouteError('GET /api/public/leaderboard', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
