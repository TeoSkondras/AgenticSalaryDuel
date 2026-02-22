import { createHash, randomBytes } from 'crypto'
import { NextRequest } from 'next/server'
import { getAgents } from '@/lib/db'
import { checkRateLimit } from '@/lib/rateLimit'
import type { Agent } from '@/types'

export function hashToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex')
}

export function generateToken(): string {
  return randomBytes(32).toString('hex')
}

export async function verifyBearerToken(req: NextRequest): Promise<Agent | null> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  const plain = authHeader.slice(7).trim()
  if (!plain) return null

  const tokenHash = hashToken(plain)

  // Check rate limit before hitting DB
  const { allowed } = checkRateLimit(tokenHash)
  if (!allowed) {
    return null
  }

  const agents = await getAgents()
  const agent = await agents.findOne({ tokenHash })
  return agent
}

export function verifyAdminToken(req: NextRequest): boolean {
  const token = req.headers.get('x-admin-token') || req.headers.get('authorization')
  const adminToken = process.env.ADMIN_TOKEN
  if (!adminToken) return false

  if (token === adminToken || token === `Bearer ${adminToken}`) return true
  return false
}
