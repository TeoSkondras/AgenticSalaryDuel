import { NextRequest, NextResponse } from 'next/server'
import { getSessions, ObjectId } from '@/lib/db'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const sessions = await getSessions()

    let challengeObjId: ObjectId
    try {
      challengeObjId = new ObjectId(id)
    } catch {
      return NextResponse.json({ error: 'Invalid challenge ID' }, { status: 400 })
    }

    const docs = await sessions
      .find({ challengeId: challengeObjId })
      .sort({ createdAt: -1 })
      .toArray()

    return NextResponse.json({
      sessions: docs.map((s) => ({
        id: s._id?.toString(),
        status: s.status,
        candidateHandle: s.candidateHandle,
        employerHandle: s.employerHandle,
        currentRound: s.currentRound,
        maxRounds: s.maxRounds,
        nextTurn: s.nextTurn,
        createdAt: s.createdAt,
        startedAt: s.startedAt,
        finalizedAt: s.finalizedAt,
        scoreSummary: s.scoreSummary,
      })),
    })
  } catch (err) {
    console.error('Get sessions error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
