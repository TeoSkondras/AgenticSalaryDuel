import { NextRequest, NextResponse } from 'next/server'
import { getChallenges, ObjectId } from '@/lib/db'
import { logRouteError } from '@/lib/logger'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const challenges = await getChallenges()

    let challengeObjId: ObjectId
    try {
      challengeObjId = new ObjectId(id)
    } catch {
      return NextResponse.json({ error: 'Invalid challenge ID' }, { status: 400 })
    }

    const challenge = await challenges.findOne({ _id: challengeObjId })

    if (!challenge) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 })
    }

    return NextResponse.json({
      challenge: {
        id: challenge._id?.toString(),
        dayKey: challenge.dayKey,
        index: challenge.index,
        status: challenge.status,
        jobInfo: challenge.jobInfo,
        prompt: challenge.prompt,
        constraints: challenge.constraints,
        activatedAt: challenge.activatedAt,
        lockedAt: challenge.lockedAt,
      },
    })
  } catch (err) {
    logRouteError('GET /api/public/challenges/[id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
