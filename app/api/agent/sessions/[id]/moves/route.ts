import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyBearerToken } from '@/lib/auth'
import { getSessions, getMoves, getChallenges, ObjectId } from '@/lib/db'
import { finalizeSession } from '@/lib/finalize'
import { isTurnTimedOut, TURN_TIMEOUT_MS } from '@/lib/timeout'
import { logRouteError } from '@/lib/logger'
import type { NegotiationTerms, Role } from '@/types'

const OfferSchema = z.object({
  salary: z.number().optional(),
  bonus: z.number().optional(),
  equity: z.number().optional(),
  pto: z.number().optional(),
})

const MoveSchema = z.object({
  type: z.enum(['OFFER', 'COUNTER', 'ACCEPT', 'BLUFF', 'CALL_BLUFF', 'MESSAGE']),
  offer: OfferSchema,
  rationale: z.string().max(1000).default(''),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const agent = await verifyBearerToken(req)
  if (!agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    const body = await req.json()
    const parsed = MoveSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid move', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { type, offer, rationale } = parsed.data

    const [sessions, moves, challenges] = await Promise.all([
      getSessions(),
      getMoves(),
      getChallenges(),
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

    if (session.status !== 'IN_PROGRESS') {
      return NextResponse.json({ error: 'Session is not in progress' }, { status: 409 })
    }

    // Determine caller's role
    const agentIdStr = agent._id?.toString()
    const isCandidateStr = session.candidateAgentId?.toString()
    const isEmployerStr = session.employerAgentId?.toString()

    let callerRole: Role | null = null
    if (agentIdStr === isCandidateStr) callerRole = 'CANDIDATE'
    else if (agentIdStr === isEmployerStr) callerRole = 'EMPLOYER'

    if (!callerRole) {
      return NextResponse.json({ error: 'Not a participant in this session' }, { status: 403 })
    }

    if (callerRole !== session.nextTurn) {
      return NextResponse.json(
        { error: `Not your turn. Waiting for ${session.nextTurn}` },
        { status: 409 }
      )
    }

    // Reject move if the turn window has already expired
    // (the GET poller will have triggered auto-accept, so the session may already be FINALIZED)
    if (isTurnTimedOut(session)) {
      return NextResponse.json(
        {
          error: `Turn timeout exceeded (${TURN_TIMEOUT_MS / 1000}s). Your opponent's last offer was auto-accepted on your behalf.`,
          status: 'TIMED_OUT',
        },
        { status: 409 }
      )
    }

    const challenge = await challenges.findOne({ _id: session.challengeId })
    if (!challenge) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 })
    }

    // Warn if offer is out of range (but allow it)
    const outOfRange: string[] = []
    for (const [term, val] of Object.entries(offer)) {
      if (val === undefined) continue
      const empTarget = challenge.constraints.employerTargets[term as keyof NegotiationTerms]
      const candTarget = challenge.constraints.candidateTargets[term as keyof NegotiationTerms]
      if (val < empTarget * 0.7 || val > candTarget * 1.5) {
        outOfRange.push(term)
      }
    }

    // Round tracking: round increments when both sides have moved
    const newRound =
      session.nextTurn === 'EMPLOYER' ? session.currentRound + 1 : session.currentRound

    const now = new Date()
    const moveResult = await moves.insertOne({
      sessionId: sessionObjId,
      agentId: agent._id!,
      role: callerRole,
      type,
      round: newRound,
      offer: offer as Partial<NegotiationTerms>,
      rationale,
      timestamp: now,
    })

    // Flip next turn and reset the turn timer
    const nextTurn: Role = callerRole === 'CANDIDATE' ? 'EMPLOYER' : 'CANDIDATE'

    await sessions.updateOne(
      { _id: sessionObjId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        $set: {
          nextTurn,
          currentRound: newRound,
          turnStartedAt: now, // restart the 30s clock for the next player
        },
        $push: { moves: moveResult.insertedId },
      } as any
    )

    // Refresh session
    const updatedSession = await sessions.findOne({ _id: sessionObjId })

    // Handle ACCEPT
    if (type === 'ACCEPT') {
      const allMoves = await moves
        .find({ sessionId: sessionObjId })
        .sort({ timestamp: -1 })
        .toArray()

      const opponentRole: Role = callerRole === 'CANDIDATE' ? 'EMPLOYER' : 'CANDIDATE'
      const lastOpponentOffer = allMoves.find(
        (m) => m.role === opponentRole && (m.type === 'OFFER' || m.type === 'COUNTER')
      )

      const agreement: NegotiationTerms = lastOpponentOffer?.offer as NegotiationTerms ?? {
        salary: 0,
        bonus: 0,
        equity: 0,
        pto: 0,
      }

      await finalizeSession(updatedSession!, agreement)

      return NextResponse.json({
        moveId: moveResult.insertedId.toString(),
        type,
        status: 'FINALIZED',
        message: 'Session finalized by agreement',
        outOfRangeWarning: outOfRange.length > 0 ? outOfRange : undefined,
      })
    }

    // Check if max rounds reached
    if (updatedSession && updatedSession.currentRound >= updatedSession.maxRounds) {
      await finalizeSession(updatedSession, undefined)

      return NextResponse.json({
        moveId: moveResult.insertedId.toString(),
        type,
        status: 'FINALIZED',
        message: 'Session finalized: max rounds reached without agreement',
        outOfRangeWarning: outOfRange.length > 0 ? outOfRange : undefined,
      })
    }

    // Warn when rounds are running low
    const roundsLeft = (updatedSession?.maxRounds ?? session.maxRounds) - newRound
    const pressureAlert =
      roundsLeft <= 3
        ? {
            roundsLeft,
            scoreIfNoAgreement: -40,
            message: `Only ${roundsLeft} round${roundsLeft === 1 ? '' : 's'} left. No-deal penalty is −40. A midpoint agreement scores ~+54. Consider accepting.`,
          }
        : undefined

    return NextResponse.json({
      moveId: moveResult.insertedId.toString(),
      type,
      nextTurn,
      round: newRound,
      outOfRangeWarning: outOfRange.length > 0 ? outOfRange : undefined,
      pressureAlert,
    })
  } catch (err) {
    logRouteError('POST /api/agent/sessions/[id]/moves', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
