#!/usr/bin/env tsx
/**
 * Two-agent simulation: heuristics-only (no OpenAI for moves).
 * Run: pnpm tsx scripts/simulate.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

const BASE_URL = process.env.APP_URL || 'http://localhost:3000'

interface Agent {
  handle: string
  token: string
  agentId: string
}

interface Challenge {
  id: string
  status: string
  jobInfo: { title: string; company: string; level: string }
  constraints: {
    maxRounds: number
    employerTargets: { salary: number; bonus: number; equity: number; pto: number }
    candidateTargets: { salary: number; bonus: number; equity: number; pto: number }
    weights: { salary: number; bonus: number; equity: number; pto: number }
  }
}

async function api(
  path: string,
  method = 'GET',
  body?: unknown,
  token?: string
): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json)}`)
  }
  return json
}

async function registerOrReuse(handle: string): Promise<Agent> {
  try {
    const data = (await api('/api/agent/register', 'POST', { handle })) as {
      agentId: string
      token: string
    }
    console.log(`✓ Registered ${handle}`)
    return { handle, token: data.token, agentId: data.agentId }
  } catch (err) {
    const msg = String(err)
    if (msg.includes('409') || msg.includes('Handle already taken')) {
      // Can't reuse without the token — use a fresh handle
      const newHandle = `${handle}_${Date.now().toString(36)}`
      const data = (await api('/api/agent/register', 'POST', { handle: newHandle })) as {
        agentId: string
        token: string
      }
      console.log(`✓ Registered ${newHandle} (${handle} was taken)`)
      return { handle: newHandle, token: data.token, agentId: data.agentId }
    }
    throw err
  }
}

async function getActiveChallenge(): Promise<Challenge> {
  const today = new Date().toISOString().slice(0, 10)
  const data = (await api(`/api/public/challenges?dayKey=${today}`)) as {
    challenges: Challenge[]
  }
  const active = data.challenges.find((c) => c.status === 'ACTIVE')
  if (!active) throw new Error('No active challenges today. Run `pnpm tsx scripts/seed.ts` first.')
  return active
}

function candidateMove(
  round: number,
  constraints: Challenge['constraints'],
  lastEmployerOffer: Record<string, number> | null,
  bluffed: boolean
) {
  const { candidateTargets, employerTargets } = constraints
  const concessionRate = 0.03 * round

  const salary = Math.round(
    candidateTargets.salary * 0.95 - candidateTargets.salary * concessionRate
  )
  const bonus = Math.round(
    candidateTargets.bonus * 0.95 - candidateTargets.bonus * concessionRate
  )
  const equity = Math.round(
    candidateTargets.equity * 0.95 - candidateTargets.equity * concessionRate
  )
  const pto = Math.round(candidateTargets.pto - round * 0.5)

  // Should ACCEPT?
  if (lastEmployerOffer) {
    const midSalary = (candidateTargets.salary + employerTargets.salary) / 2
    if (lastEmployerOffer.salary >= midSalary * 0.95) {
      return { type: 'ACCEPT' as const, offer: lastEmployerOffer, rationale: 'Acceptable offer reached.' }
    }
  }

  // Bluff on round 2 if not yet done
  if (round === 2 && !bluffed) {
    return {
      type: 'BLUFF' as const,
      offer: { salary, bonus, equity, pto },
      rationale: 'I have a competing offer at this level. Can you match or exceed it?',
    }
  }

  const type = round === 0 ? 'OFFER' : 'COUNTER'
  return {
    type: type as 'OFFER' | 'COUNTER',
    offer: { salary, bonus, equity, pto },
    rationale: `Round ${round}: targeting competitive compensation for this level.`,
  }
}

function employerMove(
  round: number,
  constraints: Challenge['constraints'],
  lastCandidateOffer: Record<string, number> | null,
  candidateBluffed: boolean
) {
  const { candidateTargets, employerTargets } = constraints
  const concessionRate = 0.02 * round

  const salary = Math.round(
    employerTargets.salary * 1.05 + employerTargets.salary * concessionRate
  )
  const bonus = Math.round(
    employerTargets.bonus * 1.05 + employerTargets.bonus * concessionRate
  )
  const equity = Math.round(
    employerTargets.equity * 1.05 + employerTargets.equity * concessionRate
  )
  const pto = Math.round(employerTargets.pto + round * 0.3)

  // Should ACCEPT?
  if (lastCandidateOffer) {
    const midSalary = (candidateTargets.salary + employerTargets.salary) / 2
    if (lastCandidateOffer.salary <= midSalary * 1.05) {
      return {
        type: 'ACCEPT' as const,
        offer: lastCandidateOffer,
        rationale: 'The candidate offer is within our range.',
      }
    }
  }

  // Call bluff if candidate bluffed
  if (candidateBluffed && round > 2) {
    return {
      type: 'CALL_BLUFF' as const,
      offer: { salary, bonus, equity, pto },
      rationale: 'We believe the competing offer claim is inflated. Here is our best counter.',
    }
  }

  const type = round === 0 ? 'OFFER' : 'COUNTER'
  return {
    type: type as 'OFFER' | 'COUNTER',
    offer: { salary, bonus, equity, pto },
    rationale: `Round ${round}: competitive package within our compensation band.`,
  }
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  console.log('=== AgenticSalaryDuel Simulation ===\n')

  const [candidate, employer] = await Promise.all([
    registerOrReuse('sim_candidate'),
    registerOrReuse('sim_employer'),
  ])

  const challenge = await getActiveChallenge()
  console.log(`\nChallenge: ${challenge.jobInfo.title} @ ${challenge.jobInfo.company}`)
  console.log(`Level: ${challenge.jobInfo.level}`)
  console.log(`Salary range: $${challenge.constraints.employerTargets.salary.toLocaleString()} – $${challenge.constraints.candidateTargets.salary.toLocaleString()}\n`)

  // Create session as candidate
  const sessionData = (await api('/api/agent/sessions', 'POST', {
    challengeId: challenge.id,
    role: 'CANDIDATE',
  }, candidate.token)) as { sessionId: string }

  const sessionId = sessionData.sessionId
  console.log(`Session created: ${sessionId}`)

  // Join as employer
  await api(`/api/agent/sessions/${sessionId}/join`, 'POST', { role: 'EMPLOYER' }, employer.token)
  console.log('Employer joined. Session IN_PROGRESS.\n')

  let round = 0
  let candidateBluffed = false
  let lastCandidateOffer: Record<string, number> | null = null
  let lastEmployerOffer: Record<string, number> | null = null

  while (round <= challenge.constraints.maxRounds) {
    // Candidate move
    const cMove = candidateMove(round, challenge.constraints, lastEmployerOffer, candidateBluffed)
    if (cMove.type === 'BLUFF') candidateBluffed = true
    if (cMove.offer) lastCandidateOffer = cMove.offer as Record<string, number>

    console.log(`[R${round}] CANDIDATE → ${cMove.type}: salary=$${(cMove.offer?.salary || 0).toLocaleString()}`)
    const cResult = (await api(`/api/agent/sessions/${sessionId}/moves`, 'POST', cMove, candidate.token)) as { status?: string }

    if (cResult.status === 'FINALIZED') {
      console.log('\n✓ Session finalized by CANDIDATE ACCEPT')
      break
    }

    await sleep(200)

    // Employer move
    const eMove = employerMove(round, challenge.constraints, lastCandidateOffer, candidateBluffed)
    if (eMove.offer) lastEmployerOffer = eMove.offer as Record<string, number>

    console.log(`[R${round}] EMPLOYER  → ${eMove.type}: salary=$${(eMove.offer?.salary || 0).toLocaleString()}`)
    const eResult = (await api(`/api/agent/sessions/${sessionId}/moves`, 'POST', eMove, employer.token)) as { status?: string }

    if (eResult.status === 'FINALIZED') {
      console.log('\n✓ Session finalized by EMPLOYER ACCEPT or max rounds')
      break
    }

    round++
    await sleep(200)
  }

  // Fetch final session
  await sleep(1000)
  const finalData = (await api(`/api/public/sessions/${sessionId}`)) as {
    session: { status: string; agreement?: Record<string, number>; scoreSummary?: Record<string, number> }
    score: Record<string, number> | null
  }

  console.log('\n=== Final Results ===')
  console.log(`Status: ${finalData.session.status}`)

  if (finalData.session.agreement) {
    const a = finalData.session.agreement
    console.log(`Agreement: salary=$${a.salary?.toLocaleString()}, bonus=$${a.bonus?.toLocaleString()}, equity=$${a.equity?.toLocaleString()}, pto=${a.pto}d`)
  }

  if (finalData.score) {
    const s = finalData.score
    console.log(`Candidate score: ${s.combinedCandidate?.toFixed(1)} (quant: ${s.quantCandidate?.toFixed(1)}, judge: ${s.judgeCandidate?.toFixed(1) || 'N/A'})`)
    console.log(`Employer score:  ${s.combinedEmployer?.toFixed(1)} (quant: ${s.quantEmployer?.toFixed(1)}, judge: ${s.judgeEmployer?.toFixed(1) || 'N/A'})`)
  }

  console.log(`\nView session: ${BASE_URL}/session/${sessionId}`)
}

main().catch((err) => {
  console.error('Simulation failed:', err.message)
  process.exit(1)
})
