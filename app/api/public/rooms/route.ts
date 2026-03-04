/**
 * GET /api/public/rooms
 * Lists recent and active multi-candidate rooms (no auth required).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getMultiRooms } from '@/lib/db'
import { logRouteError } from '@/lib/logger'

export async function GET(_req: NextRequest) {
  try {
    const rooms = await getMultiRooms()
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000)
    const docs = await rooms
      .find({ openedAt: { $gte: since } })
      .sort({ openedAt: -1 })
      .limit(48)
      .toArray()

    const list = docs.map((r) => ({
      roomId: r._id?.toString(),
      hourKey: r.hourKey,
      status: r.status,
      hasEmployer: !!r.employerAgentId,
      employerHandle: r.employerHandle ?? null,
      candidateCount: r.candidates.length,
      maxCandidates: r.maxCandidates,
      selectedAnonymousLabel: r.selectedAnonymousLabel ?? null,
      openedAt: r.openedAt,
      expiresAt: r.expiresAt,
      finalizedAt: r.finalizedAt ?? null,
    }))

    return NextResponse.json({ rooms: list })
  } catch (err) {
    logRouteError('GET /api/public/rooms', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
