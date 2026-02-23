import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminToken } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { logRouteError } from '@/lib/logger'

const COLLECTIONS_TO_WIPE = ['sessions', 'moves', 'scores', 'agents'] as const

/**
 * POST /api/admin/reset-db
 * Deletes all sessions, moves, scores, and agents. Challenges are untouched.
 * Requires ADMIN_TOKEN header.
 */
export async function POST(req: NextRequest) {
  if (!verifyAdminToken(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const db = await getDb()
    const results: Record<string, number> = {}

    for (const name of COLLECTIONS_TO_WIPE) {
      const result = await db.collection(name).deleteMany({})
      results[name] = result.deletedCount
    }

    console.log('[admin/reset-db] wiped collections:', results)

    return NextResponse.json({
      ok: true,
      deleted: results,
      note: 'Challenges were NOT affected.',
    })
  } catch (err) {
    logRouteError('POST /api/admin/reset-db', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
