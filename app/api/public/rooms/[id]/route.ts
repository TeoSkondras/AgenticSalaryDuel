/**
 * GET /api/public/rooms/[id]
 * Public room view — anonymized candidate info, no private targets exposed.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getMultiRooms, getSessions, getMoves, getMultiScores, getChallenges, ObjectId } from '@/lib/db'
import { logRouteError } from '@/lib/logger'
import { checkAndExpireRoom } from '@/lib/multiRoom'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const rooms = await getMultiRooms()
    let roomObjId: ObjectId
    try {
      roomObjId = new ObjectId(id)
    } catch {
      return NextResponse.json({ error: 'Invalid room ID' }, { status: 400 })
    }

    const room = await rooms.findOne({ _id: roomObjId })
    if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

    await checkAndExpireRoom(room)
    const freshRoom = await rooms.findOne({ _id: roomObjId })
    if (!freshRoom) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

    const [sessions, moves, multiScores, challenges] = await Promise.all([
      getSessions(), getMoves(), getMultiScores(), getChallenges(),
    ])

    const challenge = await challenges.findOne({ _id: freshRoom.challengeId })

    const candidateViews = await Promise.all(
      freshRoom.candidates.map(async (c) => {
        const session = await sessions.findOne({ _id: c.sessionId })
        const sessionMoves = session
          ? await moves.find({ sessionId: c.sessionId }).sort({ timestamp: 1 }).toArray()
          : []
        const multiScore = await multiScores.findOne({ roomId: freshRoom._id!, agentId: c.agentId })

        return {
          anonymousLabel: c.anonymousLabel,
          status: c.status,
          moveCount: sessionMoves.length,
          sessionStatus: session?.status ?? null,
          agreement: session?.agreement ?? null,
          scoreSummary: session?.scoreSummary ?? null,
          multiScore: multiScore
            ? {
                wasSelected: multiScore.wasSelected,
                combinedScore: multiScore.combinedScore,
                quantScore: multiScore.quantScore,
              }
            : null,
        }
      })
    )

    const employerMultiScore = freshRoom.employerAgentId
      ? await multiScores.findOne({ roomId: freshRoom._id!, agentId: freshRoom.employerAgentId })
      : null

    return NextResponse.json({
      room: {
        roomId: freshRoom._id?.toString(),
        hourKey: freshRoom.hourKey,
        status: freshRoom.status,
        hasEmployer: !!freshRoom.employerAgentId,
        employerHandle: freshRoom.employerHandle ?? null,
        candidateCount: freshRoom.candidates.length,
        maxCandidates: freshRoom.maxCandidates,
        selectedAnonymousLabel: freshRoom.selectedAnonymousLabel ?? null,
        openedAt: freshRoom.openedAt,
        expiresAt: freshRoom.expiresAt,
        finalizedAt: freshRoom.finalizedAt ?? null,
        challenge: challenge
          ? {
              jobInfo: challenge.jobInfo,
              constraints: {
                maxRounds: challenge.constraints.maxRounds,
                range: {
                  salary: {
                    min: challenge.constraints.employerTargets.salary,
                    max: challenge.constraints.candidateTargets.salary,
                  },
                  bonus: {
                    min: challenge.constraints.employerTargets.bonus,
                    max: challenge.constraints.candidateTargets.bonus,
                  },
                },
              },
            }
          : null,
      },
      candidates: candidateViews,
      employerScore: employerMultiScore
        ? {
            combinedScore: employerMultiScore.combinedScore,
            quantScore: employerMultiScore.quantScore,
          }
        : null,
    })
  } catch (err) {
    logRouteError('GET /api/public/rooms/[id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
