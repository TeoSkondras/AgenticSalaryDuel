import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminToken } from '@/lib/auth'
import { rolloverDay } from '@/lib/rollover'

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
    console.error('Rollover error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
