import { NextRequest, NextResponse } from 'next/server'
import { getSessions, getMoves, getChallenges, getScores, ObjectId } from '@/lib/db'
import { handleTurnTimeout } from '@/lib/timeout'
import { publicConstraints } from '@/lib/constraints'
import { logRouteError } from '@/lib/logger'

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

    // Check for turn timeout — auto-accept the opponent's last offer if the current
    // player hasn't moved in TURN_TIMEOUT_MS. Re-fetch the session after finalization.
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

    // Compute negotiation pressure for in-progress sessions
    let negotiationPressure = null
    if (session.status === 'IN_PROGRESS' && challenge) {
      const roundsLeft = session.maxRounds - session.currentRound

      // Latest substantive offer from each side (reversed for latest-first)
      const offerTypes = new Set(['OFFER', 'COUNTER', 'BLUFF'])
      const reversed = [...sessionMoves].reverse()
      const latestCandidateOffer = reversed.find(
        (m) => m.role === 'CANDIDATE' && offerTypes.has(m.type)
      )?.offer ?? null
      const latestEmployerOffer = reversed.find(
        (m) => m.role === 'EMPLOYER' && offerTypes.has(m.type)
      )?.offer ?? null

      // Gap as % of negotiation range for each term
      let gapPct: Record<string, number> | null = null
      let salaryGapPct = 100
      if (latestCandidateOffer && latestEmployerOffer) {
        gapPct = {}
        const { candidateTargets, employerTargets } = challenge.constraints
        for (const term of Object.keys(challenge.constraints.weights ?? {})) {
          const candVal = (latestCandidateOffer as Record<string, number>)[term] ?? 0
          const empVal = (latestEmployerOffer as Record<string, number>)[term] ?? 0
          const range =
            (candidateTargets as Record<string, number>)[term] -
            (employerTargets as Record<string, number>)[term]
          gapPct[term] = range > 0 ? Math.abs(candVal - empVal) / range * 100 : 0
        }
        salaryGapPct = gapPct.salary ?? 100
      }

      // Suggest accepting when gap is closable and rounds are scarce
      // Accept midpoint deal is always better than no-deal penalty (-40)
      const suggestAccept =
        roundsLeft <= 3 ||
        (roundsLeft <= 5 && salaryGapPct < 20) ||
        salaryGapPct < 10

      negotiationPressure = {
        roundsLeft,
        latestCandidateOffer,
        latestEmployerOffer,
        gapPct,
        suggestAccept,
        scoreIfNoAgreement: -40,
        note: suggestAccept
          ? 'Gap is closable or rounds are scarce — accepting now scores far better than −40.'
          : null,
      }
    }

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
        negotiationPressure,
      },
      challenge: challenge
        ? {
            id: challenge._id?.toString(),
            jobInfo: challenge.jobInfo,
            // NOTE: per-side targets are intentionally omitted here.
            // Use GET /api/agent/sessions/:id (authenticated) to receive your own targets.
            constraints: publicConstraints(challenge.constraints),
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
    logRouteError('GET /api/public/sessions/[id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
