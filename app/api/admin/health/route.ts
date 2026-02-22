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

    // Translate common Atlas/TLS errors into actionable hints
    const msg = String((err as Error).message ?? '')
    const cause = String((err as { cause?: { message?: string } }).cause?.message ?? '')
    const combined = msg + cause

    if (combined.includes('tlsv1 alert internal error') || combined.includes('SSL alert number 80')) {
      dbError.hint =
        'TLS handshake rejected by Atlas — your server IP is not in the MongoDB Atlas IP Access List. ' +
        'Go to Atlas → Security → Network Access → Add IP Address → Allow Access from Anywhere (0.0.0.0/0).'
    } else if (combined.includes('Authentication failed') || combined.includes('AuthenticationFailed')) {
      dbError.hint = 'MongoDB authentication failed — check MONGODB_URI username and password.'
    } else if (combined.includes('ENOTFOUND') || combined.includes('getaddrinfo')) {
      dbError.hint = 'DNS resolution failed — check the hostname in MONGODB_URI.'
    } else if (combined.includes('ECONNREFUSED')) {
      dbError.hint = 'Connection refused — check that the Atlas cluster is running and the port is correct.'
    } else if (combined.includes('serverSelectionTimeoutMS') || combined.includes('Server selection timed out')) {
      dbError.hint =
        'Server selection timed out — Atlas may be unreachable from this network. ' +
        'Check IP Access List and that the cluster is not paused.'
    }

    console.error('[health] DB error:', JSON.stringify(dbError))
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
