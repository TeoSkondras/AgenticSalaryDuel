/**
 * POST /api/agent/rooms  — Join or create the current hour's room
 * GET  /api/agent/rooms  — List recent rooms (last 24 hours)
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyBearerToken } from '@/lib/auth'
import { getMultiRooms, ObjectId } from '@/lib/db'
import { logRouteError } from '@/lib/logger'
import {
  getCurrentHourKey,
  getOrCreateRoomForHour,
  joinRoomAsEmployer,
  joinRoomAsCandidate,
  checkAndExpireRoom,
} from '@/lib/multiRoom'

const JoinSchema = z.object({
  role: z.enum(['EMPLOYER', 'CANDIDATE']),
  /** Optional: join a specific hour's room (defaults to current hour). Format: "YYYY-MM-DD-HH" */
  hourKey: z.string().regex(/^\d{4}-\d{2}-\d{2}-\d{2}$/).optional(),
})

export async function POST(req: NextRequest) {
  const agent = await verifyBearerToken(req)
  if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const parsed = JoinSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
    }

    const { role, hourKey: requestedHourKey } = parsed.data
    const hourKey = requestedHourKey ?? getCurrentHourKey()

    let room
    try {
      room = await getOrCreateRoomForHour(hourKey)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: msg }, { status: 409 })
    }

    // Check expiry
    const expired = await checkAndExpireRoom(room)
    if (expired) {
      return NextResponse.json({ error: 'That room has already expired' }, { status: 409 })
    }

    if (role === 'EMPLOYER') {
      try {
        await joinRoomAsEmployer(room._id!, agent)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return NextResponse.json({ error: msg }, { status: 409 })
      }

      return NextResponse.json({
        roomId: room._id!.toString(),
        hourKey: room.hourKey,
        role: 'EMPLOYER',
        status: room.status,
        expiresAt: room.expiresAt,
        message: 'Joined as employer. Waiting for candidates.',
      })
    }

    // CANDIDATE
    let sessionId: string
    let anonymousLabel: string
    try {
      const result = await joinRoomAsCandidate(room._id!, agent)
      sessionId = result.sessionId.toString()
      anonymousLabel = result.anonymousLabel
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: msg }, { status: 409 })
    }

    return NextResponse.json({
      roomId: room._id!.toString(),
      hourKey: room.hourKey,
      role: 'CANDIDATE',
      anonymousLabel,
      sessionId,
      status: 'IN_PROGRESS',
      expiresAt: room.expiresAt,
      message: `You are ${anonymousLabel}. Make your opening offer via POST /api/agent/rooms/{roomId}/moves`,
    })
  } catch (err) {
    logRouteError('POST /api/agent/rooms', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const agent = await verifyBearerToken(req)
  if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const rooms = await getMultiRooms()
    // Last 48 hours + next 1 hour
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000)
    const docs = await rooms
      .find({ openedAt: { $gte: since } })
      .sort({ openedAt: -1 })
      .limit(50)
      .toArray()

    const agentIdStr = agent._id?.toString()
    const list = docs.map((r) => ({
      roomId: r._id?.toString(),
      hourKey: r.hourKey,
      status: r.status,
      hasEmployer: !!r.employerAgentId,
      candidateCount: r.candidates.length,
      maxCandidates: r.maxCandidates,
      myRole: r.employerAgentId?.toString() === agentIdStr
        ? 'EMPLOYER'
        : r.candidates.some((c) => c.agentId.toString() === agentIdStr)
          ? 'CANDIDATE'
          : null,
      openedAt: r.openedAt,
      expiresAt: r.expiresAt,
      finalizedAt: r.finalizedAt,
    }))

    return NextResponse.json({ rooms: list })
  } catch (err) {
    logRouteError('GET /api/agent/rooms', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
