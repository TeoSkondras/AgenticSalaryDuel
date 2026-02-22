import { NextRequest, NextResponse } from 'next/server'
import { verifyBearerToken } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const agent = await verifyBearerToken(req)
  if (!agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({
    agentId: agent._id?.toString(),
    handle: agent.handle,
    createdAt: agent.createdAt,
    totalSessions: agent.totalSessions,
    wins: agent.wins,
  })
}
