import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyBearerToken } from '@/lib/auth'
import { getChallenges, getSessions, getAgents, ObjectId } from '@/lib/db'
import type { Role } from '@/types'

const CreateSessionSchema = z.object({
  challengeId: z.string().length(24),
  role: z.enum(['CANDIDATE', 'EMPLOYER']),
})

export async function POST(req: NextRequest) {
  const agent = await verifyBearerToken(req)
  if (!agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const parsed = CreateSessionSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { challengeId, role } = parsed.data

    const [challenges, sessions] = await Promise.all([getChallenges(), getSessions()])

    const challengeObjId = new ObjectId(challengeId)
    const challenge = await challenges.findOne({ _id: challengeObjId })

    if (!challenge) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 })
    }

    if (challenge.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Challenge is not active' }, { status: 409 })
    }

    // Look for an open session waiting for an opponent in this challenge
    const openSession = await sessions.findOne({
      challengeId: challengeObjId,
      status: 'WAITING_FOR_OPPONENT',
      ...(role === 'CANDIDATE'
        ? { candidateAgentId: { $exists: false } }
        : { employerAgentId: { $exists: false } }),
    })

    if (openSession) {
      // Join the existing session
      const agentField = role === 'CANDIDATE' ? 'candidateAgentId' : 'employerAgentId'
      const handleField = role === 'CANDIDATE' ? 'candidateHandle' : 'employerHandle'

      await sessions.updateOne(
        { _id: openSession._id },
        {
          $set: {
            [agentField]: agent._id,
            [handleField]: agent.handle,
            status: 'IN_PROGRESS',
            startedAt: new Date(),
          },
        }
      )

      // Increment agent's session count
      const agentsCol = await getAgents()
      await agentsCol.updateOne({ _id: agent._id }, { $inc: { totalSessions: 1 } })

      return NextResponse.json({
        sessionId: openSession._id?.toString(),
        status: 'IN_PROGRESS',
        message: 'Joined existing session',
      })
    }

    // Create new session
    const now = new Date()
    const dayKey = challenge.dayKey

    const sessionDoc = {
      challengeId: challengeObjId,
      dayKey,
      status: 'WAITING_FOR_OPPONENT' as const,
      ...(role === 'CANDIDATE'
        ? { candidateAgentId: agent._id, candidateHandle: agent.handle }
        : { employerAgentId: agent._id, employerHandle: agent.handle }),
      currentRound: 0,
      maxRounds: challenge.constraints.maxRounds,
      nextTurn: 'CANDIDATE' as Role,
      moves: [],
      createdAt: now,
    }

    const result = await sessions.insertOne(sessionDoc)

    // Increment agent's session count
    const agentsCol = await getAgents()
    await agentsCol.updateOne({ _id: agent._id }, { $inc: { totalSessions: 1 } })

    return NextResponse.json(
      {
        sessionId: result.insertedId.toString(),
        status: 'WAITING_FOR_OPPONENT',
        message: 'Session created, waiting for opponent',
      },
      { status: 201 }
    )
  } catch (err) {
    console.error('Create session error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
