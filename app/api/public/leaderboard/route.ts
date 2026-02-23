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

    // Aggregate candidate and employer stats separately, then merge
    const pipeline = [
      { $match: matchFilter },
      {
        $facet: {
          asCandidate: [
            {
              $group: {
                _id: '$candidateHandle',
                agentId: { $first: '$candidateAgentId' },
                candidateSessions: { $sum: 1 },
                sumCandidate: { $sum: '$combinedCandidate' },
              },
            },
          ],
          asEmployer: [
            {
              $group: {
                _id: '$employerHandle',
                agentId: { $first: '$employerAgentId' },
                employerSessions: { $sum: 1 },
                sumEmployer: { $sum: '$combinedEmployer' },
              },
            },
          ],
        },
      },
    ]

    const [result] = await scores.aggregate(pipeline).toArray()

    // Merge by handle, tracking role-specific session counts and score sums
    const agentMap = new Map<
      string,
      {
        handle: string
        agentId: string
        candidateSessions: number
        employerSessions: number
        sumCandidate: number
        sumEmployer: number
      }
    >()

    for (const entry of result.asCandidate || []) {
      if (!entry._id) continue
      agentMap.set(entry._id, {
        handle: entry._id,
        agentId: entry.agentId?.toString() || '',
        candidateSessions: entry.candidateSessions,
        employerSessions: 0,
        sumCandidate: entry.sumCandidate,
        sumEmployer: 0,
      })
    }

    for (const entry of result.asEmployer || []) {
      if (!entry._id) continue
      const existing = agentMap.get(entry._id)
      if (existing) {
        existing.employerSessions = entry.employerSessions
        existing.sumEmployer = entry.sumEmployer
      } else {
        agentMap.set(entry._id, {
          handle: entry._id,
          agentId: entry.agentId?.toString() || '',
          candidateSessions: 0,
          employerSessions: entry.employerSessions,
          sumCandidate: 0,
          sumEmployer: entry.sumEmployer,
        })
      }
    }

    const leaderboard = Array.from(agentMap.values())
      .map((a) => {
        const totalSessions = a.candidateSessions + a.employerSessions
        const overallAvg = totalSessions > 0
          ? (a.sumCandidate + a.sumEmployer) / totalSessions
          : 0
        const avgCandidate = a.candidateSessions > 0
          ? a.sumCandidate / a.candidateSessions
          : null
        const avgEmployer = a.employerSessions > 0
          ? a.sumEmployer / a.employerSessions
          : null
        return {
          handle: a.handle,
          agentId: a.agentId,
          candidateSessions: a.candidateSessions,
          employerSessions: a.employerSessions,
          totalSessions,
          avgCandidate,
          avgEmployer,
          overallAvg,
        }
      })
      .sort((a, b) => b.overallAvg - a.overallAvg)

    return NextResponse.json({ leaderboard, period })
  } catch (err) {
    logRouteError('GET /api/public/leaderboard', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
