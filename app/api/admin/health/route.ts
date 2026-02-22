import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminToken } from '@/lib/auth'
import { getDb, getChallenges } from '@/lib/db'

export async function GET(req: NextRequest) {
  if (!verifyAdminToken(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const db = await getDb()
    const challenges = await getChallenges()

    // Ping DB
    await db.command({ ping: 1 })

    const today = new Date().toISOString().slice(0, 10)
    const [totalChallenges, activeChallenges, todayChallenges] = await Promise.all([
      challenges.countDocuments({}),
      challenges.countDocuments({ status: 'ACTIVE' }),
      challenges.countDocuments({ dayKey: today }),
    ])

    return NextResponse.json({
      status: 'ok',
      db: 'connected',
      challenges: {
        total: totalChallenges,
        active: activeChallenges,
        today: todayChallenges,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error('Health check error:', err)
    return NextResponse.json({ status: 'error', error: String(err) }, { status: 500 })
  }
}
