import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminToken } from '@/lib/auth'
import { rolloverDay } from '@/lib/rollover'
import { logRouteError } from '@/lib/logger'

export async function POST(req: NextRequest) {
  if (!verifyAdminToken(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await rolloverDay()
    return NextResponse.json({
      message: 'Rollover complete',
      ...result,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    logRouteError('POST /api/admin/rollover-day', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
