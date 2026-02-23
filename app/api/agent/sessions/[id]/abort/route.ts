import { NextRequest, NextResponse } from 'next/server'
import { verifyBearerToken } from '@/lib/auth'
import { getSessions, ObjectId } from '@/lib/db'
import { finalizeSession } from '@/lib/finalize'
import { logRouteError } from '@/lib/logger'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const agent = await verifyBearerToken(req)
  if (!agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    const sessions = await getSessions()

    let sessionObjId: ObjectId
    try {
      sessionObjId = new ObjectId(id)
    } catch {
      return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 })
    }

    const session = await sessions.findOne({ _id: sessionObjId })

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const agentIdStr = agent._id?.toString()
    const isParticipant =
      session.candidateAgentId?.toString() === agentIdStr ||
      session.employerAgentId?.toString() === agentIdStr

    if (!isParticipant) {
      return NextResponse.json({ error: 'Not a participant in this session' }, { status: 403 })
    }

    if (!['WAITING_FOR_OPPONENT', 'IN_PROGRESS'].includes(session.status)) {
      return NextResponse.json(
        { error: 'Session cannot be aborted in current state' },
        { status: 409 }
      )
    }

    // Score and close the session with the abort penalty (-50 each).
    // This ensures aborting cannot dodge the leaderboard.
    await finalizeSession(session, undefined, { aborted: true })

    return NextResponse.json({
      message: 'Session aborted. Abort penalty (-50) applied to both participants.',
      sessionId: id,
    })
  } catch (err) {
    logRouteError('POST /api/agent/sessions/[id]/abort', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
