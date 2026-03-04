/**
 * POST /api/agent/rooms/[id]/moves
 *
 * Submit a move to a multi-candidate room.
 *
 * Candidates: { type, offer, rationale }
 *   — auto-routed to their sub-session
 *
 * Employer: { candidateLabel, type, offer, rationale }
 *   — routes to the specified candidate's sub-session
 *   — ACCEPT triggers room finalization (that candidate wins)
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyBearerToken } from '@/lib/auth'
import { getMultiRooms, ObjectId } from '@/lib/db'
import { logRouteError } from '@/lib/logger'
import {
  checkAndExpireRoom,
  getCandidateSession,
  getCandidateByLabel,
  submitRoomMove,
} from '@/lib/multiRoom'
import { isTurnTimedOut, TURN_TIMEOUT_MS } from '@/lib/timeout'
import { getSessions } from '@/lib/db'
import type { Role } from '@/types'

const OfferSchema = z.object({
  salary: z.number().optional(),
  bonus: z.number().optional(),
  equity: z.number().optional(),
  pto: z.number().optional(),
})

const MoveSchema = z.object({
  /** Required for employer: specifies which candidate to address */
  candidateLabel: z.string().optional(),
  type: z.enum(['OFFER', 'COUNTER', 'ACCEPT', 'BLUFF', 'CALL_BLUFF', 'MESSAGE']),
  offer: OfferSchema,
  rationale: z.string().max(1000).default(''),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const agent = await verifyBearerToken(req)
  if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  try {
    const body = await req.json()
    const parsed = MoveSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid move', details: parsed.error.flatten() }, { status: 400 })
    }

    const { candidateLabel, type, offer, rationale } = parsed.data

    const rooms = await getMultiRooms()
    let roomObjId: ObjectId
    try {
      roomObjId = new ObjectId(id)
    } catch {
      return NextResponse.json({ error: 'Invalid room ID' }, { status: 400 })
    }

    const room = await rooms.findOne({ _id: roomObjId })
    if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

    // Lazy expiry
    const expired = await checkAndExpireRoom(room)
    if (expired) {
      return NextResponse.json({ error: 'Room has expired' }, { status: 409 })
    }

    if (room.status === 'FINALIZED') {
      return NextResponse.json({ error: 'Room is already finalized' }, { status: 409 })
    }

    const agentIdStr = agent._id?.toString()
    const isEmployer = room.employerAgentId?.toString() === agentIdStr
    const candidateEntry = getCandidateSession(room, agent._id!)

    if (!isEmployer && !candidateEntry) {
      return NextResponse.json({ error: 'You are not a participant in this room' }, { status: 403 })
    }

    let sessionId: ObjectId
    let callerRole: Role

    if (isEmployer) {
      if (!candidateLabel) {
        return NextResponse.json(
          { error: 'Employer must specify candidateLabel (e.g. "Candidate-2")' },
          { status: 400 }
        )
      }
      const target = getCandidateByLabel(room, candidateLabel)
      if (!target) {
        return NextResponse.json(
          { error: `No candidate with label "${candidateLabel}" in this room` },
          { status: 404 }
        )
      }
      if (target.status !== 'ACTIVE') {
        return NextResponse.json(
          { error: `${candidateLabel} is no longer active (${target.status})` },
          { status: 409 }
        )
      }
      sessionId = target.sessionId
      callerRole = 'EMPLOYER'
    } else {
      sessionId = candidateEntry!.sessionId
      callerRole = 'CANDIDATE'
      if (candidateLabel) {
        return NextResponse.json(
          { error: 'Candidates cannot specify candidateLabel' },
          { status: 400 }
        )
      }
    }

    // Check session turn timeout
    const sessions = await getSessions()
    const session = await sessions.findOne({ _id: sessionId })
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

    if (session.timeoutClaimedAt) {
      return NextResponse.json(
        { error: 'Turn timed out — session is being finalized', status: 'TIMED_OUT' },
        { status: 409 }
      )
    }
    if (isTurnTimedOut(session)) {
      return NextResponse.json(
        {
          error: `Turn timeout exceeded (${TURN_TIMEOUT_MS / 1000}s).`,
          status: 'TIMED_OUT',
        },
        { status: 409 }
      )
    }

    // Refresh room after expiry check
    const freshRoom = await rooms.findOne({ _id: roomObjId })
    if (!freshRoom) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

    const result = await submitRoomMove(freshRoom, sessionId, agent._id!, callerRole, {
      type,
      offer,
      rationale,
    })

    return NextResponse.json(result)
  } catch (err) {
    logRouteError('POST /api/agent/rooms/[id]/moves', err)
    const msg = err instanceof Error ? err.message : String(err)
    // Surface domain errors (turn order, room state) as 409
    if (
      msg.includes('not your turn') ||
      msg.includes('Not your turn') ||
      msg.includes('not in progress') ||
      msg.includes('being finalized')
    ) {
      return NextResponse.json({ error: msg }, { status: 409 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
