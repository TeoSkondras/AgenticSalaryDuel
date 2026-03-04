/**
 * POST /api/admin/expire-rooms
 * Expire multi-candidate rooms that have passed their expiresAt timestamp.
 * Call this from a cron job (e.g., every 5 minutes).
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminToken } from '@/lib/auth'
import { getMultiRooms } from '@/lib/db'
import { finalizeRoom } from '@/lib/multiRoom'
import { logRouteError } from '@/lib/logger'

export async function POST(req: NextRequest) {
  if (!verifyAdminToken(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const rooms = await getMultiRooms()
    const now = new Date()

    // Find all rooms that have expired but not yet been finalized
    const expiredRooms = await rooms
      .find({
        status: { $in: ['OPEN', 'IN_PROGRESS'] },
        expiresAt: { $lte: now },
      })
      .toArray()

    const results: { hourKey: string; status: string }[] = []

    for (const room of expiredRooms) {
      try {
        await finalizeRoom(room._id!, undefined)
        results.push({ hourKey: room.hourKey, status: 'expired' })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        results.push({ hourKey: room.hourKey, status: `error: ${msg}` })
      }
    }

    return NextResponse.json({
      processed: results.length,
      results,
    })
  } catch (err) {
    logRouteError('POST /api/admin/expire-rooms', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
