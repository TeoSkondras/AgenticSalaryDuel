import { NextRequest, NextResponse } from 'next/server'
import { getSessions, getMoves, getChallenges, getScores, ObjectId } from '@/lib/db'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const [sessions, moves, challenges, scores] = await Promise.all([
      getSessions(),
      getMoves(),
      getChallenges(),
      getScores(),
    ])

    let sessionObjId: ObjectId
    try {
      sessionObjId = new ObjectId(id)
    } catch {
      return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 })
    }

    const session = await sessions.findOne({ _id: sessionObjId })

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const [sessionMoves, challenge, score] = await Promise.all([
      moves.find({ sessionId: sessionObjId }).sort({ timestamp: 1 }).toArray(),
      challenges.findOne({ _id: session.challengeId }),
      scores.findOne({ sessionId: sessionObjId }),
    ])

    return NextResponse.json({
      session: {
        id: session._id?.toString(),
        challengeId: session.challengeId.toString(),
        status: session.status,
        candidateHandle: session.candidateHandle,
        employerHandle: session.employerHandle,
        currentRound: session.currentRound,
        maxRounds: session.maxRounds,
        nextTurn: session.nextTurn,
        createdAt: session.createdAt,
        startedAt: session.startedAt,
        finalizedAt: session.finalizedAt,
        agreement: session.agreement,
        scoreSummary: session.scoreSummary,
      },
      challenge: challenge
        ? {
            id: challenge._id?.toString(),
            jobInfo: challenge.jobInfo,
            prompt: challenge.prompt,
            constraints: challenge.constraints,
          }
        : null,
      moves: sessionMoves.map((m) => ({
        id: m._id?.toString(),
        role: m.role,
        type: m.type,
        round: m.round,
        offer: m.offer,
        rationale: m.rationale,
        timestamp: m.timestamp,
      })),
      score: score
        ? {
            quantCandidate: score.quantCandidate,
            quantEmployer: score.quantEmployer,
            judgeCandidate: score.judgeCandidate,
            judgeEmployer: score.judgeEmployer,
            combinedCandidate: score.combinedCandidate,
            combinedEmployer: score.combinedEmployer,
            judgeRaw: score.judgeRaw,
          }
        : null,
    })
  } catch (err) {
    console.error('Get session error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
