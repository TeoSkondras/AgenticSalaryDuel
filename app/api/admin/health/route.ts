import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminToken } from '@/lib/auth'
import { getDb, getChallenges, formatError } from '@/lib/db'

export async function GET(req: NextRequest) {
  const isAdmin = verifyAdminToken(req)

  // Non-admins get a minimal liveness check (no DB details)
  if (!isAdmin) {
    return NextResponse.json({ status: 'ok', timestamp: new Date().toISOString() })
  }

  const today = new Date().toISOString().slice(0, 10)
  const start = Date.now()

  // Check which env vars are present (not their values)
  const envCheck = {
    MONGODB_URI: !!process.env.MONGODB_URI,
    MONGODB_DB: process.env.MONGODB_DB || '(default: agenticsalaryduel)',
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    APP_URL: process.env.APP_URL || '(not set)',
    ADMIN_TOKEN: !!process.env.ADMIN_TOKEN,
    NODE_ENV: process.env.NODE_ENV,
  }

  console.log('[health] env check:', envCheck)

  if (!process.env.MONGODB_URI) {
    return NextResponse.json(
      {
        status: 'error',
        error: 'MONGODB_URI is not set',
        env: envCheck,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }

  // Attempt DB connection + ping
  let dbStatus: 'ok' | 'error' = 'error'
  let pingMs: number | null = null
  let dbError: Record<string, unknown> | null = null
  let counts: Record<string, number> = {}

  try {
    console.log('[health] connecting to DB...')
    const db = await getDb()

    const pingStart = Date.now()
    await db.command({ ping: 1 })
    pingMs = Date.now() - pingStart
    console.log(`[health] ping OK in ${pingMs}ms`)

    const challenges = await getChallenges()
    const [total, active, todayCount] = await Promise.all([
      challenges.countDocuments({}),
      challenges.countDocuments({ status: 'ACTIVE' }),
      challenges.countDocuments({ dayKey: today }),
    ])

    counts = { total, active, today: todayCount }
    dbStatus = 'ok'
  } catch (err) {
    dbError = formatError(err)
    console.error('[health] DB error:', dbError)
  }

  const totalMs = Date.now() - start

  const payload = {
    status: dbStatus,
    db: dbStatus === 'ok' ? 'connected' : 'error',
    pingMs,
    totalMs,
    env: envCheck,
    today,
    challenges: dbStatus === 'ok' ? counts : undefined,
    error: dbError ?? undefined,
    timestamp: new Date().toISOString(),
  }

  console.log('[health] result:', JSON.stringify({ ...payload, error: dbError ? '(see above)' : null }))

  return NextResponse.json(payload, { status: dbStatus === 'ok' ? 200 : 500 })
}
