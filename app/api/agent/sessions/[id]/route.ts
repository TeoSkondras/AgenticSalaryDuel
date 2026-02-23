import { NextRequest, NextResponse } from 'next/server'
import { getSessions, getMoves, getChallenges, getScores, ObjectId } from '@/lib/db'
import { verifyBearerToken } from '@/lib/auth'
import { handleTurnTimeout } from '@/lib/timeout'
import { publicConstraints, myTargets } from '@/lib/constraints'
import { logRouteError } from '@/lib/logger'
import type { Role } from '@/types'

/**
 * GET /api/agent/sessions/:id
 *
 * Authenticated version of the session view.
 * Returns the same data as the public endpoint PLUS `constraints.myTargets` —
 * the caller's own negotiation goal — while keeping the opponent's targets private.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const agent = await verifyBearerToken(req)
  if (!agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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

    // Determine caller's role (may be a spectator with no role)
    const agentIdStr = agent._id?.toString()
    let callerRole: Role | null = null
    if (agentIdStr === session.candidateAgentId?.toString()) callerRole = 'CANDIDATE'
    else if (agentIdStr === session.employerAgentId?.toString()) callerRole = 'EMPLOYER'

    // Check for turn timeout
    if (session.status === 'IN_PROGRESS') {
      const timedOut = await handleTurnTimeout(session)
      if (timedOut) {
        const fresh = await sessions.findOne({ _id: sessionObjId })
        if (fresh) Object.assign(session, fresh)
      }
    }

    const [sessionMoves, challenge, score] = await Promise.all([
      moves.find({ sessionId: sessionObjId }).sort({ timestamp: 1 }).toArray(),
      challenges.findOne({ _id: session.challengeId }),
      scores.findOne({ sessionId: sessionObjId }),
    ])

    // Build challenge payload: public range + caller's own targets only
    const challengePayload = challenge
      ? {
          id: challenge._id?.toString(),
          jobInfo: challenge.jobInfo,
          constraints: {
            ...publicConstraints(challenge.constraints),
            // Only expose the caller's own targets — never the opponent's
            myTargets: callerRole ? myTargets(challenge.constraints, callerRole) : undefined,
            myRole: callerRole ?? undefined,
          },
        }
      : null

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
        myRole: callerRole,
        createdAt: session.createdAt,
        startedAt: session.startedAt,
        turnStartedAt: session.turnStartedAt,
        finalizedAt: session.finalizedAt,
        agreement: session.agreement,
        scoreSummary: session.scoreSummary,
      },
      challenge: challengePayload,
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
    logRouteError('GET /api/agent/sessions/[id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
