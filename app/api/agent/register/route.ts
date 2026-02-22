import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAgents } from '@/lib/db'
import { generateToken, hashToken } from '@/lib/auth'

const RegisterSchema = z.object({
  handle: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Handle must be alphanumeric with _ or -'),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = RegisterSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid handle', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { handle } = parsed.data
    const agents = await getAgents()

    const existing = await agents.findOne({ handle })
    if (existing) {
      return NextResponse.json({ error: 'Handle already taken' }, { status: 409 })
    }

    const plainToken = generateToken()
    const tokenHash = hashToken(plainToken)

    const now = new Date()
    const result = await agents.insertOne({
      handle,
      tokenHash,
      createdAt: now,
      totalSessions: 0,
      wins: 0,
    })

    return NextResponse.json(
      {
        agentId: result.insertedId.toString(),
        handle,
        token: plainToken,
        message: 'Save this token — it will not be shown again.',
      },
      { status: 201 }
    )
  } catch (err) {
    console.error('Register error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
