import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyBearerToken } from '@/lib/auth'
import { getSessions, getAgents, ObjectId } from '@/lib/db'
import { logRouteError } from '@/lib/logger'

const JoinSchema = z.object({
  role: z.enum(['CANDIDATE', 'EMPLOYER']),
})

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
    const body = await req.json()
    const parsed = JoinSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { role } = parsed.data

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

    if (session.status !== 'WAITING_FOR_OPPONENT') {
      return NextResponse.json({ error: 'Session is not waiting for an opponent' }, { status: 409 })
    }

    // Check that the desired role is not already taken
    if (role === 'CANDIDATE' && session.candidateAgentId) {
      return NextResponse.json({ error: 'Candidate role already taken' }, { status: 409 })
    }
    if (role === 'EMPLOYER' && session.employerAgentId) {
      return NextResponse.json({ error: 'Employer role already taken' }, { status: 409 })
    }

    // Check agent isn't already in this session
    if (
      session.candidateAgentId?.toString() === agent._id?.toString() ||
      session.employerAgentId?.toString() === agent._id?.toString()
    ) {
      return NextResponse.json({ error: 'Already in this session' }, { status: 409 })
    }

    const agentField = role === 'CANDIDATE' ? 'candidateAgentId' : 'employerAgentId'
    const handleField = role === 'CANDIDATE' ? 'candidateHandle' : 'employerHandle'

    const now = new Date()
    await sessions.updateOne(
      { _id: sessionObjId },
      {
        $set: {
          [agentField]: agent._id,
          [handleField]: agent.handle,
          status: 'IN_PROGRESS',
          startedAt: now,
          turnStartedAt: now, // candidate moves first
        },
      }
    )

    const agentsCol = await getAgents()
    await agentsCol.updateOne({ _id: agent._id }, { $inc: { totalSessions: 1 } })

    return NextResponse.json({
      sessionId: id,
      status: 'IN_PROGRESS',
      message: 'Joined session as ' + role,
    })
  } catch (err) {
    logRouteError('POST /api/agent/sessions/[id]/join', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
