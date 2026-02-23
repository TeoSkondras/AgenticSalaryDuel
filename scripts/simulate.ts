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

interface Constraints {
  maxRounds: number
  employerTargets: { salary: number; bonus: number; equity: number; pto: number }
  candidateTargets: { salary: number; bonus: number; equity: number; pto: number }
  weights: { salary: number; bonus: number; equity: number; pto: number }
}

interface Challenge {
  id: string
  status: string
  jobInfo: { title: string; company: string; level: string }
  constraints: Constraints
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

/** Linearly interpolate: t=0 → from, t=1 → to */
function lerp(from: number, to: number, t: number) {
  return Math.round(from + (to - from) * Math.min(1, t))
}

/**
 * Candidate strategy:
 * - Starts ambitious (90% of max), concedes toward midpoint as rounds pass.
 * - Bluffs at round 2, uses MESSAGE mid-game to signal willingness.
 * - Accept threshold widens each round; forced accept in last 2 rounds.
 */
function candidateMove(
  round: number,
  maxRounds: number,
  constraints: Constraints,
  lastEmployerOffer: Record<string, number> | null,
  bluffed: boolean,
  messageSent: boolean
) {
  const { candidateTargets: ct, employerTargets: et } = constraints

  // Concession progress: 0 = full ask, 1 = midpoint
  const progress = Math.min(1, round / (maxRounds * 0.7))

  const mid = (v: keyof typeof ct) => Math.round((ct[v] + et[v]) / 2)

  const salary = lerp(Math.round(ct.salary * 0.90), mid('salary'), progress)
  const bonus  = lerp(Math.round(ct.bonus  * 0.90), mid('bonus'),  progress)
  const equity = lerp(Math.round(ct.equity * 0.90), mid('equity'), progress)
  const pto    = lerp(ct.pto, mid('pto'), progress)

  // Accept decision: widen threshold as rounds run out
  if (lastEmployerOffer) {
    const roundsLeft = maxRounds - round
    // How far through the range is the employer's offer (0 = employer target, 1 = candidate target)
    const salaryRange = ct.salary - et.salary
    const offerPosition = (lastEmployerOffer.salary - et.salary) / (salaryRange || 1)

    // Accept threshold: starts at 0.4 (slightly below midpoint), rises as rounds dwindle
    const acceptThreshold = 0.35 + (1 - roundsLeft / maxRounds) * 0.25

    if (offerPosition >= acceptThreshold || roundsLeft <= 2) {
      const reason =
        roundsLeft <= 2
          ? `Final rounds — accepting to avoid the −40 no-deal penalty.`
          : `Offer at ${(offerPosition * 100).toFixed(0)}% of range — meets my minimum at round ${round}.`
      return {
        type: 'ACCEPT' as const,
        offer: lastEmployerOffer,
        rationale: reason,
      }
    }
  }

  // Bluff at round 2 once
  if (round === 2 && !bluffed) {
    return {
      type: 'BLUFF' as const,
      offer: { salary, bonus, equity, pto },
      rationale:
        'I have a competing offer at a higher level. I prefer this role for the mission, but I need the numbers to match. Can you improve?',
    }
  }

  // Mid-game MESSAGE to signal flexibility and propose splitting the difference
  if (round === Math.floor(maxRounds * 0.5) && !messageSent && lastEmployerOffer) {
    const splitSalary = Math.round((salary + lastEmployerOffer.salary) / 2)
    return {
      type: 'MESSAGE' as const,
      offer: { salary: splitSalary, bonus, equity, pto },
      rationale: `Round ${round}: Let's close this. I'm proposing we split the salary difference at $${splitSalary.toLocaleString()}. That's a fair midpoint between your last offer and mine.`,
    }
  }

  const type = round === 0 ? 'OFFER' : 'COUNTER'
  const concessionPct = (progress * 100).toFixed(0)
  return {
    type: type as 'OFFER' | 'COUNTER',
    offer: { salary, bonus, equity, pto },
    rationale: `Round ${round} (${concessionPct}% into concession range): targeting competitive compensation while leaving room to negotiate.`,
  }
}

/**
 * Employer strategy:
 * - Starts conservative (110% of floor), concedes toward midpoint as rounds pass.
 * - Calls bluff at round 3+, uses MESSAGE mid-game with "best final offer" framing.
 * - Accept threshold widens each round; forced accept in last 2 rounds.
 */
function employerMove(
  round: number,
  maxRounds: number,
  constraints: Constraints,
  lastCandidateOffer: Record<string, number> | null,
  candidateBluffed: boolean,
  messageSent: boolean
) {
  const { candidateTargets: ct, employerTargets: et } = constraints

  const progress = Math.min(1, round / (maxRounds * 0.7))
  const mid = (v: keyof typeof et) => Math.round((ct[v] + et[v]) / 2)

  const salary = lerp(Math.round(et.salary * 1.10), mid('salary'), progress)
  const bonus  = lerp(Math.round(et.bonus  * 1.10), mid('bonus'),  progress)
  const equity = lerp(Math.round(et.equity * 1.10), mid('equity'), progress)
  const pto    = lerp(et.pto, mid('pto'), progress)

  // Accept decision
  if (lastCandidateOffer) {
    const roundsLeft = maxRounds - round
    const salaryRange = ct.salary - et.salary
    // How far into the range is the candidate's ask (0 = employer target, 1 = candidate target)
    const askPosition = (lastCandidateOffer.salary - et.salary) / (salaryRange || 1)

    // Accept if ask is in the lower 65% + widens as rounds run out
    const acceptThreshold = 0.65 - (1 - roundsLeft / maxRounds) * 0.25

    if (askPosition <= acceptThreshold || roundsLeft <= 2) {
      const reason =
        roundsLeft <= 2
          ? `Last rounds — accepting to avoid the −40 no-deal penalty and secure this hire.`
          : `Candidate is at ${(askPosition * 100).toFixed(0)}% of range — within our compensation band at round ${round}.`
      return {
        type: 'ACCEPT' as const,
        offer: lastCandidateOffer,
        rationale: reason,
      }
    }
  }

  // Call bluff at round 3+ if candidate bluffed
  if (candidateBluffed && round >= 3) {
    return {
      type: 'CALL_BLUFF' as const,
      offer: { salary, bonus, equity, pto },
      rationale: `We've done market benchmarking and believe the competing offer claim is inflated. Here is our data-driven counter: $${salary.toLocaleString()} base with strong equity upside.`,
    }
  }

  // Mid-game MESSAGE anchoring on our "best offer"
  if (round === Math.floor(maxRounds * 0.5) && !messageSent && lastCandidateOffer) {
    const splitSalary = Math.round((salary + lastCandidateOffer.salary) / 2)
    return {
      type: 'MESSAGE' as const,
      offer: { salary: splitSalary, bonus, equity, pto },
      rationale: `Round ${round}: In the interest of closing, I'm prepared to meet you halfway at $${splitSalary.toLocaleString()}. This is at the top of our band for this level.`,
    }
  }

  const type = round === 0 ? 'OFFER' : 'COUNTER'
  const concessionPct = (progress * 100).toFixed(0)
  return {
    type: type as 'OFFER' | 'COUNTER',
    offer: { salary, bonus, equity, pto },
    rationale: `Round ${round} (${concessionPct}% into concession range): competitive package within our compensation band for this level.`,
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
  const { employerTargets: et, candidateTargets: ct, maxRounds } = challenge.constraints
  console.log(`\nChallenge: ${challenge.jobInfo.title} @ ${challenge.jobInfo.company}`)
  console.log(`Level: ${challenge.jobInfo.level}`)
  console.log(`Salary range: $${et.salary.toLocaleString()} (employer floor) – $${ct.salary.toLocaleString()} (candidate target)`)
  console.log(`Midpoint: $${Math.round((et.salary + ct.salary) / 2).toLocaleString()}`)
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
  console.log('Employer joined. Session IN_PROGRESS.\n')

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
      round, maxRounds, challenge.constraints,
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
      round, maxRounds, challenge.constraints,
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
