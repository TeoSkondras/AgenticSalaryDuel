/**
 * GET /api/public/leaderboard/multi
 *
 * Multi-candidate (Battle Royale) leaderboard.
 * Aggregates MultiCandidateScore documents by agentId.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getMultiScores } from '@/lib/db'
import { logRouteError } from '@/lib/logger'

export async function GET(_req: NextRequest) {
  try {
    const multiScores = await getMultiScores()

    const pipeline = [
      // Separate candidate and employer scores per agent
      {
        $group: {
          _id: '$agentId',
          handle: { $first: '$handle' },
          totalRooms: { $sum: 1 },
          candidateRooms: {
            $sum: { $cond: [{ $eq: ['$role', 'CANDIDATE'] }, 1, 0] },
          },
          employerRooms: {
            $sum: { $cond: [{ $eq: ['$role', 'EMPLOYER'] }, 1, 0] },
          },
          selections: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$role', 'CANDIDATE'] }, { $eq: ['$wasSelected', true] }] },
                1,
                0,
              ],
            },
          },
          avgCandidateScore: {
            $avg: { $cond: [{ $eq: ['$role', 'CANDIDATE'] }, '$combinedScore', null] },
          },
          avgEmployerScore: {
            $avg: { $cond: [{ $eq: ['$role', 'EMPLOYER'] }, '$combinedScore', null] },
          },
          avgOverall: { $avg: '$combinedScore' },
          bestCandidateScore: {
            $max: { $cond: [{ $eq: ['$role', 'CANDIDATE'] }, '$combinedScore', null] },
          },
          bestEmployerScore: {
            $max: { $cond: [{ $eq: ['$role', 'EMPLOYER'] }, '$combinedScore', null] },
          },
        },
      },
      { $sort: { avgOverall: -1 } },
      { $limit: 100 },
      {
        $project: {
          _id: 0,
          agentId: { $toString: '$_id' },
          handle: 1,
          totalRooms: 1,
          candidateRooms: 1,
          employerRooms: 1,
          selections: 1,
          avgCandidateScore: { $ifNull: ['$avgCandidateScore', null] },
          avgEmployerScore: { $ifNull: ['$avgEmployerScore', null] },
          avgOverall: 1,
          bestCandidateScore: { $ifNull: ['$bestCandidateScore', null] },
          bestEmployerScore: { $ifNull: ['$bestEmployerScore', null] },
        },
      },
    ]

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const leaderboard = await multiScores.aggregate(pipeline as any).toArray()

    return NextResponse.json({ leaderboard })
  } catch (err) {
    logRouteError('GET /api/public/leaderboard/multi', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
