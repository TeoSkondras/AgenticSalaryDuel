#!/usr/bin/env tsx
/**
 * Two-agent simulation: heuristics-only (no OpenAI for moves).
 * Demonstrates a realistic negotiation arc that converges to agreement.
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

type Terms = { salary: number; bonus: number; equity: number; pto: number }

interface PublicConstraints {
  maxRounds: number
  weights: Terms
  range: Record<string, { min: number; max: number }>
}

interface AgentConstraints extends PublicConstraints {
  /** Only the caller's own targets — populated by GET /api/agent/sessions/:id */
  myTargets: Terms
  myRole: 'CANDIDATE' | 'EMPLOYER'
}

interface Challenge {
  id: string
  status: string
  jobInfo: { title: string; company: string; level: string }
  constraints: PublicConstraints
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

/** Fetch role-specific targets from the authenticated session endpoint. */
async function getMyConstraints(sessionId: string, token: string): Promise<AgentConstraints> {
  const data = (await api(`/api/agent/sessions/${sessionId}`, 'GET', undefined, token)) as {
    challenge: { constraints: AgentConstraints }
  }
  return data.challenge.constraints
}

/** Linearly interpolate: t=0 → from, t=1 → to */
function lerp(from: number, to: number, t: number) {
  return Math.round(from + (to - from) * Math.min(1, t))
}

/**
 * Candidate strategy — only knows its OWN target and the public range.
 * Does NOT know the employer's target.
 */
function candidateMove(
  round: number,
  maxRounds: number,
  constraints: AgentConstraints,
  lastOpponentOffer: Record<string, number> | null,
  bluffed: boolean,
  messageSent: boolean
) {
  const { myTargets, range } = constraints
  const rangeMin = range.salary?.min ?? myTargets.salary * 0.7
  const rangeMax = range.salary?.max ?? myTargets.salary
  const salarySpan = rangeMax - rangeMin

  // Concede from 90% of my target down toward 60% of the range (above midpoint)
  const progress = Math.min(1, round / (maxRounds * 0.7))
  const startSalary = Math.round(myTargets.salary * 0.90)
  const floorSalary = Math.round(rangeMin + salarySpan * 0.55) // stay above midpoint
  const salary = lerp(startSalary, floorSalary, progress)
  const bonus  = lerp(Math.round(myTargets.bonus * 0.90),  Math.round((range.bonus?.min ?? 0)  + (((range.bonus?.max  ?? 0) - (range.bonus?.min  ?? 0)) * 0.55)), progress)
  const equity = lerp(Math.round(myTargets.equity * 0.90), Math.round((range.equity?.min ?? 0) + (((range.equity?.max ?? 0) - (range.equity?.min ?? 0)) * 0.55)), progress)
  const pto    = lerp(myTargets.pto, Math.round((range.pto?.min ?? myTargets.pto) + (((range.pto?.max ?? myTargets.pto) - (range.pto?.min ?? myTargets.pto)) * 0.55)), progress)

  // Accept decision: based on what opponent offered vs the range
  if (lastOpponentOffer) {
    const roundsLeft = maxRounds - round
    const offerPosition = (lastOpponentOffer.salary - rangeMin) / (salarySpan || 1)
    const acceptThreshold = 0.35 + (1 - roundsLeft / maxRounds) * 0.25
    if (offerPosition >= acceptThreshold || roundsLeft <= 2) {
      const reason = roundsLeft <= 2
        ? `Final rounds — accepting to avoid the −40 no-deal penalty.`
        : `Offer is at ${(offerPosition * 100).toFixed(0)}% of the range — meets my threshold at round ${round}.`
      return { type: 'ACCEPT' as const, offer: lastOpponentOffer, rationale: reason }
    }
  }

  if (round === 2 && !bluffed) {
    return {
      type: 'BLUFF' as const,
      offer: { salary, bonus, equity, pto },
      rationale: 'I have a competing offer at a higher level. I prefer this role for the mission, but I need the numbers to match. Can you improve?',
    }
  }

  if (round === Math.floor(maxRounds * 0.5) && !messageSent && lastOpponentOffer) {
    const splitSalary = Math.round((salary + lastOpponentOffer.salary) / 2)
    return {
      type: 'MESSAGE' as const,
      offer: { salary: splitSalary, bonus, equity, pto },
      rationale: `Round ${round}: Let's close this. Proposing we split the difference at $${splitSalary.toLocaleString()}.`,
    }
  }

  const type = round === 0 ? 'OFFER' : 'COUNTER'
  return {
    type: type as 'OFFER' | 'COUNTER',
    offer: { salary, bonus, equity, pto },
    rationale: `Round ${round}: targeting competitive compensation (${(progress * 100).toFixed(0)}% into my concession range).`,
  }
}

/**
 * Employer strategy — only knows its OWN target and the public range.
 * Does NOT know the candidate's target.
 */
function employerMove(
  round: number,
  maxRounds: number,
  constraints: AgentConstraints,
  lastOpponentOffer: Record<string, number> | null,
  candidateBluffed: boolean,
  messageSent: boolean
) {
  const { myTargets, range } = constraints
  const rangeMin = range.salary?.min ?? myTargets.salary
  const rangeMax = range.salary?.max ?? myTargets.salary * 1.4
  const salarySpan = rangeMax - rangeMin

  const progress = Math.min(1, round / (maxRounds * 0.7))
  const startSalary = Math.round(myTargets.salary * 1.10)
  const ceilingSalary = Math.round(rangeMin + salarySpan * 0.50) // stay at or below midpoint
  const salary = lerp(startSalary, ceilingSalary, progress)
  const bonus  = lerp(Math.round(myTargets.bonus * 1.10),  Math.round((range.bonus?.min ?? 0)  + (((range.bonus?.max  ?? 0) - (range.bonus?.min  ?? 0)) * 0.50)), progress)
  const equity = lerp(Math.round(myTargets.equity * 1.10), Math.round((range.equity?.min ?? 0) + (((range.equity?.max ?? 0) - (range.equity?.min ?? 0)) * 0.50)), progress)
  const pto    = lerp(myTargets.pto, Math.round((range.pto?.min ?? myTargets.pto) + (((range.pto?.max ?? myTargets.pto) - (range.pto?.min ?? myTargets.pto)) * 0.50)), progress)

  if (lastOpponentOffer) {
    const roundsLeft = maxRounds - round
    const askPosition = (lastOpponentOffer.salary - rangeMin) / (salarySpan || 1)
    const acceptThreshold = 0.65 - (1 - roundsLeft / maxRounds) * 0.25
    if (askPosition <= acceptThreshold || roundsLeft <= 2) {
      const reason = roundsLeft <= 2
        ? `Last rounds — accepting to avoid the −40 no-deal penalty.`
        : `Candidate ask is at ${(askPosition * 100).toFixed(0)}% of range — within our band at round ${round}.`
      return { type: 'ACCEPT' as const, offer: lastOpponentOffer, rationale: reason }
    }
  }

  if (candidateBluffed && round >= 3) {
    return {
      type: 'CALL_BLUFF' as const,
      offer: { salary, bonus, equity, pto },
      rationale: `Market benchmarking suggests the competing offer is inflated. Our data-driven counter: $${salary.toLocaleString()} base with strong equity upside.`,
    }
  }

  if (round === Math.floor(maxRounds * 0.5) && !messageSent && lastOpponentOffer) {
    const splitSalary = Math.round((salary + lastOpponentOffer.salary) / 2)
    return {
      type: 'MESSAGE' as const,
      offer: { salary: splitSalary, bonus, equity, pto },
      rationale: `Round ${round}: Prepared to meet halfway at $${splitSalary.toLocaleString()}. Top of our band for this level.`,
    }
  }

  const type = round === 0 ? 'OFFER' : 'COUNTER'
  return {
    type: type as 'OFFER' | 'COUNTER',
    offer: { salary, bonus, equity, pto },
    rationale: `Round ${round}: competitive package within our compensation band (${(progress * 100).toFixed(0)}% into concession range).`,
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
  const maxRounds = challenge.constraints.maxRounds
  console.log(`\nChallenge: ${challenge.jobInfo.title} @ ${challenge.jobInfo.company}`)
  console.log(`Level: ${challenge.jobInfo.level}`)
  const r = challenge.constraints.range
  console.log(`Salary range: $${r.salary?.min.toLocaleString()} – $${r.salary?.max.toLocaleString()} (public range only)`)
  console.log(`Max rounds: ${maxRounds}\n`)

  // Create session as candidate
  const sessionData = (await api('/api/agent/sessions', 'POST', {
    challengeId: challenge.id,
    role: 'CANDIDATE',
  }, candidate.token)) as { sessionId: string }

  const sessionId = sessionData.sessionId
  console.log(`Session: ${sessionId}`)

  // Join as employer
  await api(`/api/agent/sessions/${sessionId}/join`, 'POST', { role: 'EMPLOYER' }, employer.token)
  console.log('Employer joined. Session IN_PROGRESS.')

  // Each agent fetches ONLY its own targets — opponent's targets remain private
  const [candidateConstraints, employerConstraints] = await Promise.all([
    getMyConstraints(sessionId, candidate.token),
    getMyConstraints(sessionId, employer.token),
  ])
  console.log(`Candidate target salary: $${candidateConstraints.myTargets.salary.toLocaleString()} (private)`)
  console.log(`Employer  target salary: $${employerConstraints.myTargets.salary.toLocaleString()} (private)\n`)

  let round = 0
  let candidateBluffed = false
  let candidateMessageSent = false
  let employerMessageSent = false
  let lastCandidateOffer: Record<string, number> | null = null
  let lastEmployerOffer: Record<string, number> | null = null
  let done = false

  while (round <= maxRounds && !done) {
    // --- Candidate move ---
    const cMove = candidateMove(
      round, maxRounds, candidateConstraints,
      lastEmployerOffer, candidateBluffed, candidateMessageSent
    )
    if (cMove.type === 'BLUFF') candidateBluffed = true
    if (cMove.type === 'MESSAGE') candidateMessageSent = true
    if (cMove.offer && cMove.type !== 'ACCEPT') lastCandidateOffer = cMove.offer as Record<string, number>

    const salaryStr = cMove.type === 'ACCEPT'
      ? `accepts $${((cMove.offer as Record<string, number>)?.salary ?? 0).toLocaleString()}`
      : `$${(cMove.offer as Record<string, number>)?.salary?.toLocaleString()}`
    console.log(`[R${round}] CANDIDATE → ${cMove.type.padEnd(10)} ${salaryStr}`)

    const cResult = (await api(
      `/api/agent/sessions/${sessionId}/moves`, 'POST', cMove, candidate.token
    )) as { status?: string; pressureAlert?: { message: string } }

    if (cResult.pressureAlert) {
      console.log(`         ⚠ ${cResult.pressureAlert.message}`)
    }
    if (cResult.status === 'FINALIZED') {
      console.log('\n✓ Session finalized (candidate accepted)')
      done = true
      break
    }

    await sleep(200)

    // --- Employer move ---
    const eMove = employerMove(
      round, maxRounds, employerConstraints,
      lastCandidateOffer, candidateBluffed, employerMessageSent
    )
    if (eMove.type === 'MESSAGE') employerMessageSent = true
    if (eMove.offer && eMove.type !== 'ACCEPT') lastEmployerOffer = eMove.offer as Record<string, number>

    const eSalaryStr = eMove.type === 'ACCEPT'
      ? `accepts $${((eMove.offer as Record<string, number>)?.salary ?? 0).toLocaleString()}`
      : `$${(eMove.offer as Record<string, number>)?.salary?.toLocaleString()}`
    console.log(`[R${round}] EMPLOYER  → ${eMove.type.padEnd(10)} ${eSalaryStr}`)

    const eResult = (await api(
      `/api/agent/sessions/${sessionId}/moves`, 'POST', eMove, employer.token
    )) as { status?: string; pressureAlert?: { message: string } }

    if (eResult.pressureAlert) {
      console.log(`         ⚠ ${eResult.pressureAlert.message}`)
    }
    if (eResult.status === 'FINALIZED') {
      console.log('\n✓ Session finalized (employer accepted or max rounds)')
      done = true
      break
    }

    round++
    await sleep(200)
  }

  // Fetch final session
  await sleep(1000)
  const finalData = (await api(`/api/public/sessions/${sessionId}`)) as {
    session: {
      status: string
      agreement?: Record<string, number>
      scoreSummary?: Record<string, number>
    }
    score: Record<string, number> | null
  }

  console.log('\n=== Final Results ===')
  console.log(`Status: ${finalData.session.status}`)

  if (finalData.session.agreement) {
    const a = finalData.session.agreement
    console.log(
      `Agreement: salary=$${a.salary?.toLocaleString()}, bonus=$${a.bonus?.toLocaleString()}, equity=$${a.equity?.toLocaleString()}, pto=${a.pto}d`
    )
  }

  if (finalData.score) {
    const s = finalData.score
    console.log(
      `Candidate: ${s.combinedCandidate?.toFixed(1)} (quant: ${s.quantCandidate?.toFixed(1)}, judge: ${s.judgeCandidate?.toFixed(1) ?? 'N/A'})`
    )
    console.log(
      `Employer:  ${s.combinedEmployer?.toFixed(1)} (quant: ${s.quantEmployer?.toFixed(1)}, judge: ${s.judgeEmployer?.toFixed(1) ?? 'N/A'})`
    )
  }

  console.log(`\nView session: ${BASE_URL}/session/${sessionId}`)
}

main().catch((err) => {
  console.error('Simulation failed:', err.message)
  process.exit(1)
})
