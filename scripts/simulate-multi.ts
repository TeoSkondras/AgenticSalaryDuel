#!/usr/bin/env tsx
/**
 * AgenticSalaryDuel — Multi-Candidate (Battle Royale) Simulation
 *
 * Simulates 1 employer vs 8 candidates (6 named + 2 bots) with different
 * negotiation strategies. Shows how greed backfires, strategic positioning
 * wins, and the employer must evaluate all offers to pick the best deal.
 *
 * Run: pnpm simulate-multi
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

const BASE_URL = process.env.APP_URL || 'http://localhost:3000'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentCreds { handle: string; token: string; agentId: string }
type Terms = { salary: number; bonus: number; equity: number; pto: number }
type MoveType = 'OFFER' | 'COUNTER' | 'ACCEPT' | 'BLUFF' | 'CALL_BLUFF' | 'MESSAGE'
type Move = { type: MoveType; offer: Terms; rationale: string }

interface RoomState {
  roomId: string
  hourKey: string
  status: string
  employerHandle: string
  candidateCount: number
  expiresAt: string
  candidates?: {
    anonymousLabel: string
    status: string
    sessionId: string
    moveCount: number
    nextTurn: string
    sessionStatus: string
    currentRound: number
    maxRounds: number
    latestCandidateOffer: Partial<Terms> | null
    latestEmployerOffer: Partial<Terms> | null
    agreement: Terms | null
    scoreSummary: Record<string, number> | null
  }[]
}

interface AgentConstraints {
  maxRounds: number
  weights: Terms
  range: Record<string, { min: number; max: number }>
  myTargets: Terms
  myRole: 'CANDIDATE' | 'EMPLOYER'
}

// ─── Candidate Strategies ─────────────────────────────────────────────────────

interface CandidateStrategy {
  handle: string
  name: string
  description: string
  aggressionFactor: number  // 0.0 = employer min, 1.0 = candidate max
  concessionRate: number    // how fast they drop their ask per round
  maxRoundsToHold: number   // how many rounds before conceding
  botMode?: 'random_walk' | 'mirror'
  rationale: (round: number, salary: number, context: string) => string
}

const CANDIDATE_STRATEGIES: CandidateStrategy[] = [
  {
    handle: 'karl_the_hacker',
    name: 'Karl Chacker',
    description: 'Greedy overreacher — demands way above market, refuses to budge',
    aggressionFactor: 1.15,
    concessionRate: 0.02,
    maxRoundsToHold: 8,
    rationale: (round, salary, ctx) =>
      round === 0
        ? `I hacked the comp database. I know what you pay the CEO. $${salary.toLocaleString()} or I deploy my counteroffer.sh script. ${ctx}`
        : `sudo raise --force $${salary.toLocaleString()}. My skills have zero vulnerabilities. Accept or get pwned.`,
  },
  {
    handle: 'matthieu_the_wise',
    name: 'Matthieu Hakim',
    description: 'Strategic negotiator — wise concessions, strong positioning',
    aggressionFactor: 0.90,
    concessionRate: 0.08,
    maxRoundsToHold: 4,
    rationale: (round, salary, ctx) =>
      round === 0
        ? `As the ancient proverb says: "Pay well, retain well." My research suggests $${salary.toLocaleString()} is P75. ${ctx}. I am open to wisdom from both sides.`
        : `I have meditated on your offer. $${salary.toLocaleString()} brings balance to the negotiation. Let us find the middle path.`,
  },
  {
    handle: 'elie_wingspan',
    name: 'Elie Juvenspan',
    description: 'Data nerd — cites Levels.fyi for everything, methodical',
    aggressionFactor: 0.80,
    concessionRate: 0.07,
    maxRoundsToHold: 5,
    rationale: (round, salary, ctx) =>
      round === 0
        ? `Per Levels.fyi (n=847, p=0.001, last 14 days, adjusted for wingspan), P65 = ~$${salary.toLocaleString()}. ${ctx}. My spreadsheet has 47 tabs.`
        : `Round ${round}: after re-running my Monte Carlo sim (10k iterations), $${salary.toLocaleString()} converges within 2 standard deviations of market.`,
  },
  {
    handle: 'ioannis_unpronounceable',
    name: 'Ioannis Panagiotopoulos',
    description: 'Pragmatic & steady — reasonable ask, closes deals while you spell his name',
    aggressionFactor: 0.75,
    concessionRate: 0.10,
    maxRoundsToHold: 3,
    rationale: (round, salary, ctx) =>
      round === 0
        ? `While you figure out how to pronounce my name, let me save time: $${salary.toLocaleString()} is competitive and realistic. ${ctx}`
        : `Round ${round}: $${salary.toLocaleString()} works. I've spent longer spelling my surname on forms than this negotiation should take.`,
  },
  {
    handle: 'theo_the_original',
    name: 'Theo Skondras (OG)',
    description: 'Eager lowballer — undersells himself, just happy to be here',
    aggressionFactor: 0.45,
    concessionRate: 0.05,
    maxRoundsToHold: 6,
    rationale: (round, salary, ctx) =>
      round === 0
        ? `Honestly, just being in the room is a W. $${salary.toLocaleString()} works. I'll bring snacks to standup. ${ctx}`
        : `Still happy at $${salary.toLocaleString()}. Did I mention I make great coffee? The vibes matter more than the zeros.`,
  },
  {
    handle: 'theo_the_sequel',
    name: 'Theo Skondras (Reloaded)',
    description: 'Anchoring bluffer — starts absurdly high to anchor, then concedes fast',
    aggressionFactor: 0.95,
    concessionRate: 0.12,
    maxRoundsToHold: 3,
    rationale: (round, salary, ctx) =>
      round === 0
        ? `The sequel is always more expensive. $${salary.toLocaleString()} — and yes, I AM the improved version. ${ctx}`
        : `Fine, I'll give you the director's cut discount: $${salary.toLocaleString()}. But the post-credits scene (equity) better be good.`,
  },
  {
    handle: 'bot_epsilon',
    name: 'Bot Epsilon (Chaos)',
    description: 'Random walk bot — picks random offers within range each round',
    aggressionFactor: 0.50,
    concessionRate: 0.0,
    maxRoundsToHold: 99,
    botMode: 'random_walk',
    rationale: (round, salary) =>
      round === 0
        ? `BEEP BOOP. Random seed initialized. Offer: $${salary.toLocaleString()}. Do not ask me to explain. I cannot.`
        : `Dice rolled. New number: $${salary.toLocaleString()}. My neural net has no layers. This is pure entropy.`,
  },
  {
    handle: 'bot_sigma',
    name: 'Bot Sigma (Mirror)',
    description: 'Mirror bot — copies employer offer with a small markup, relentless',
    aggressionFactor: 0.55,
    concessionRate: 0.0,
    maxRoundsToHold: 99,
    botMode: 'mirror',
    rationale: (round, salary) =>
      round === 0
        ? `I see your offer. I raise you 8%. $${salary.toLocaleString()}. I am simply you, but better.`
        : `Mirror protocol engaged. Your last offer + 8% = $${salary.toLocaleString()}. Resistance is suboptimal.`,
  },
]

// ─── Employer Strategy ────────────────────────────────────────────────────────

const EMPLOYER_PERSONA = {
  name: 'smart_talent_director',
  open: (candidateLabel: string, salary: number) =>
    `Welcome ${candidateLabel}. Our opening offer is $${salary.toLocaleString()} base — top of our ${salary > 200000 ? 'senior' : 'mid'} band. We believe in fair compensation and a strong equity story.`,
  counter: (round: number, candidateLabel: string, salary: number) =>
    `${candidateLabel}, round ${round}: We've reviewed your ask and can move to $${salary.toLocaleString()}. This is a genuine stretch that reflects our interest in you specifically.`,
  accept: (candidateLabel: string, salary: number, reason: string) =>
    `${candidateLabel}: We're accepting your terms at $${salary.toLocaleString()}. ${reason}. Welcome aboard.`,
  reject: (candidateLabel: string) =>
    `Thank you ${candidateLabel}, we're going in another direction that better fits our budget parameters.`,
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function api(path: string, method = 'GET', body?: unknown, token?: string, timeoutMs = 30_000): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    const json = await res.json()
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json)}`)
    return json
  } finally {
    clearTimeout(timer)
  }
}

async function registerAgent(handleBase: string): Promise<AgentCreds> {
  const handle = `${handleBase}_${Date.now().toString(36).slice(-4)}`
  const data = (await api('/api/agent/register', 'POST', { handle })) as { agentId: string; token: string }
  return { handle, token: data.token, agentId: data.agentId }
}

async function getMyConstraints(sessionId: string, token: string): Promise<AgentConstraints> {
  const data = (await api(`/api/agent/sessions/${sessionId}`, 'GET', undefined, token)) as {
    challenge: { constraints: AgentConstraints }
  }
  return data.challenge.constraints
}

async function getRoomState(roomId: string, token: string): Promise<RoomState> {
  return (await api(`/api/agent/rooms/${roomId}`, 'GET', undefined, token)) as RoomState
}

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

function lerp(a: number, b: number, t: number) { return Math.round(a + (b - a) * Math.min(1, t)) }

function getHourKey(offsetHours = 0): string {
  const d = new Date(Date.now() + offsetHours * 60 * 60 * 1000)
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  })
  const parts = Object.fromEntries(
    fmt.formatToParts(d).map((p) => [p.type, p.value])
  )
  const h = Number(parts.hour) % 24
  return `${parts.year}-${parts.month}-${parts.day}-${String(h).padStart(2, '0')}`
}

// ─── Offer computation ────────────────────────────────────────────────────────

function randInRange(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min))
}

function computeCandidateOffer(
  round: number,
  strategy: CandidateStrategy,
  constraints: AgentConstraints,
  lastEmployerOffer?: Terms | null,
): Terms {
  const { range } = constraints

  if (strategy.botMode === 'random_walk') {
    return {
      salary: randInRange(range.salary?.min ?? 150000, range.salary?.max ?? 250000),
      bonus: randInRange(range.bonus?.min ?? 0, range.bonus?.max ?? 0),
      equity: randInRange(range.equity?.min ?? 0, range.equity?.max ?? 0),
      pto: randInRange(range.pto?.min ?? 15, range.pto?.max ?? 25),
    }
  }

  if (strategy.botMode === 'mirror' && lastEmployerOffer) {
    const markup = 1.08
    return {
      salary: Math.min(Math.round(lastEmployerOffer.salary * markup), range.salary?.max ?? 250000),
      bonus: Math.min(Math.round(lastEmployerOffer.bonus * markup), range.bonus?.max ?? 0),
      equity: Math.min(Math.round(lastEmployerOffer.equity * markup), range.equity?.max ?? 0),
      pto: Math.min(Math.round(lastEmployerOffer.pto * 1.05), range.pto?.max ?? 25),
    }
  }

  const rangeMin = range.salary?.min ?? 150000
  const rangeMax = range.salary?.max ?? 250000
  const salaryCandTarget = rangeMax
  const salaryEmpTarget = rangeMin

  const startSalary = Math.round(salaryEmpTarget + (salaryCandTarget - salaryEmpTarget) * strategy.aggressionFactor)
  const concededSalary = lerp(startSalary, rangeMin, Math.min(1, round * strategy.concessionRate))

  const bonusStart = Math.round((range.bonus?.min ?? 0) + ((range.bonus?.max ?? 0) - (range.bonus?.min ?? 0)) * strategy.aggressionFactor)
  const bonusConceded = lerp(bonusStart, range.bonus?.min ?? 0, Math.min(1, round * strategy.concessionRate))

  const equityStart = Math.round((range.equity?.min ?? 0) + ((range.equity?.max ?? 0) - (range.equity?.min ?? 0)) * strategy.aggressionFactor)
  const equityConceded = lerp(equityStart, range.equity?.min ?? 0, Math.min(1, round * strategy.concessionRate))

  const ptoMax = range.pto?.max ?? 25
  const ptoMin = range.pto?.min ?? 15
  const ptoStart = Math.round(ptoMin + (ptoMax - ptoMin) * strategy.aggressionFactor)

  return {
    salary: concededSalary,
    bonus: bonusConceded,
    equity: equityConceded,
    pto: ptoStart,
  }
}

function computeEmployerOffer(round: number, constraints: AgentConstraints): Terms {
  const { range } = constraints
  // Start stingy, move toward midpoint over rounds
  const prog = Math.min(1, round / (constraints.maxRounds * 0.7))
  return {
    salary: lerp(
      Math.round((range.salary?.min ?? 150000) * 1.05),
      Math.round((range.salary?.min ?? 150000) + ((range.salary?.max ?? 250000) - (range.salary?.min ?? 150000)) * 0.45),
      prog
    ),
    bonus: lerp(
      range.bonus?.min ?? 0,
      Math.round((range.bonus?.min ?? 0) + ((range.bonus?.max ?? 0) - (range.bonus?.min ?? 0)) * 0.45),
      prog
    ),
    equity: lerp(
      range.equity?.min ?? 0,
      Math.round((range.equity?.min ?? 0) + ((range.equity?.max ?? 0) - (range.equity?.min ?? 0)) * 0.45),
      prog
    ),
    pto: range.pto?.min ?? 15,
  }
}

// ─── Output helpers ───────────────────────────────────────────────────────────

const BAR = '━'.repeat(70)

function fmtTerms(t: Partial<Terms>): string {
  return `$${(t.salary ?? 0).toLocaleString()} base | $${(t.bonus ?? 0).toLocaleString()} bonus | $${(t.equity ?? 0).toLocaleString()} equity | ${t.pto ?? '?'}d PTO`
}

// ─── Main simulation ──────────────────────────────────────────────────────────

async function main() {
  console.log()
  console.log('╔══════════════════════════════════════════════════════════════════════╗')
  console.log('║       AgenticSalaryDuel — Battle Royale Simulation                  ║')
  console.log('║       1 Employer vs 8 Candidates (6 Named + 2 Bots)                ║')
  console.log('╚══════════════════════════════════════════════════════════════════════╝')
  console.log(`  Platform: ${BASE_URL}\n`)

  // ── 1. Register all agents ──
  console.log('  Registering agents...')
  const employerAgent = await registerAgent('smart_talent_dir')
  const candidateAgents: { creds: AgentCreds; strategy: CandidateStrategy }[] = []

  for (const strategy of CANDIDATE_STRATEGIES) {
    const creds = await registerAgent(strategy.handle)
    candidateAgents.push({ creds, strategy })
    await sleep(100)
  }

  console.log(`  Employer: ${employerAgent.handle}`)
  for (const { creds, strategy } of candidateAgents) {
    console.log(`  Candidate: ${creds.handle} (${strategy.description})`)
  }

  // ── 2 & 3. Find a free hour, join as employer, then join all candidates ──
  // Retries if the hour is taken, closed, expired, or the room is already full.
  console.log('\n  Finding available room...')
  let roomData!: { roomId: string; hourKey: string; expiresAt: string; status: string }
  const candidateSessions: { creds: AgentCreds; strategy: CandidateStrategy; sessionId: string; label: string }[] = []

  for (let attempt = 0; attempt < 48; attempt++) {
    const targetHourKey = getHourKey(attempt)

    // Try to claim the employer slot
    try {
      roomData = (await api('/api/agent/rooms', 'POST', {
        role: 'EMPLOYER', hourKey: targetHourKey,
      }, employerAgent.token)) as typeof roomData
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('already has an employer') || msg.includes('closed') || msg.includes('expired')) {
        console.log(`    Hour +${attempt} unavailable, trying +${attempt + 1}...`)
        continue
      }
      throw err
    }

    // Employer is in — now try to join all candidates with the same hourKey
    let roomFull = false
    const joined: typeof candidateSessions = []
    for (const { creds, strategy } of candidateAgents) {
      try {
        const joinData = (await api('/api/agent/rooms', 'POST', {
          role: 'CANDIDATE', hourKey: targetHourKey,
        }, creds.token)) as { sessionId: string; anonymousLabel: string }
        joined.push({ creds, strategy, sessionId: joinData.sessionId, label: joinData.anonymousLabel })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('full')) {
          console.log(`    Hour +${attempt} room is full, trying +${attempt + 1}...`)
          roomFull = true
          break
        }
        console.error(`    Failed to join as ${creds.handle}:`, msg.slice(0, 80))
      }
      await sleep(200)
    }
    if (roomFull) continue

    candidateSessions.push(...joined)
    break
  }

  const { roomId, hourKey } = roomData
  console.log(`  Room: ${roomId} (${hourKey})`)
  console.log(`  Expires: ${new Date(roomData.expiresAt).toISOString()}\n`)

  console.log('  Candidates joined:')
  for (const cs of candidateSessions) {
    console.log(`    ${cs.label}: ${cs.creds.handle} (${cs.strategy.name})`)
  }

  // ── 4. Fetch constraints for all participants ──
  console.log('\n  Fetching constraints...')
  const eConstraints = await getMyConstraints(candidateSessions[0].sessionId, employerAgent.token)
  console.log(`  Salary range: $${eConstraints.range.salary?.min.toLocaleString()} – $${eConstraints.range.salary?.max.toLocaleString()}`)
  console.log(`  Max rounds: ${eConstraints.maxRounds}`)

  const candidateConstraintsMap = new Map<string, AgentConstraints>()
  for (const cs of candidateSessions) {
    const c = await getMyConstraints(cs.sessionId, cs.creds.token)
    candidateConstraintsMap.set(cs.sessionId, c)
    await sleep(100)
  }

  // ── 5. Negotiation rounds ──
  console.log(`\n${BAR}`)
  console.log('  NEGOTIATION BEGINS')
  console.log(BAR)

  const maxRounds = eConstraints.maxRounds
  let roomDone = false
  let round = 0

  // Track per-candidate state
  const candidateState = new Map(candidateSessions.map(cs => [cs.sessionId, {
    active: true, bluffed: false, messageSent: false, lastOffer: null as Terms | null,
  }]))

  const employerState = new Map(candidateSessions.map(cs => [cs.sessionId, {
    lastOffer: null as Terms | null,
  }]))

  while (round <= maxRounds && !roomDone) {
    console.log(`\n  ── Round ${round} ──`)

    // ── Candidates move ──
    for (const cs of candidateSessions) {
      const state = candidateState.get(cs.sessionId)!
      if (!state.active) continue

      const constraints = candidateConstraintsMap.get(cs.sessionId)!
      const empLastOffer = employerState.get(cs.sessionId)?.lastOffer
      const offer = computeCandidateOffer(round, cs.strategy, constraints, empLastOffer)
      const context = round === 0 ? `Position: ${eConstraints.range.salary?.min}k–${eConstraints.range.salary?.max}k range` : ''
      const rationale = cs.strategy.rationale(round, offer.salary, context)

      const moveType: MoveType = round === 0 ? 'OFFER' : 'COUNTER'

      try {
        const result = (await api(`/api/agent/rooms/${roomId}/moves`, 'POST', {
          type: moveType, offer, rationale,
        }, cs.creds.token)) as { status?: string; error?: string }

        if (result.status === 'FINALIZED') {
          state.active = false
        } else {
          state.lastOffer = offer
        }
        console.log(`    [CAND] ${cs.label.padEnd(12)} ${moveType.padEnd(8)} salary=$${offer.salary.toLocaleString()} (${cs.strategy.name})`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('not in progress') || msg.includes('not your turn') || msg.includes('timed out')) {
          state.active = false
          console.log(`    [CAND] ${cs.label.padEnd(12)} SKIP     (session ended)`)
        } else {
          console.error(`    [CAND] ${cs.label.padEnd(12)} ERROR:`, msg.slice(0, 60))
        }
      }

      await sleep(150)
    }

    // ── Employer reviews and responds ──
    // Employer gets full view of room state
    let roomState: RoomState
    try {
      roomState = await getRoomState(roomId, employerAgent.token)
    } catch {
      break
    }

    if (roomState.status === 'FINALIZED' || roomState.status === 'EXPIRED') {
      roomDone = true
      break
    }

    const activeCandidates = (roomState.candidates ?? []).filter(c => c.status === 'ACTIVE' && c.sessionId)

    for (const candidateView of activeCandidates) {
      const sessionId = candidateView.sessionId
      const cs = candidateSessions.find(c => c.sessionId === sessionId)
      if (!cs) continue

      const empState = employerState.get(sessionId)!
      const candidateLatestOffer = candidateView.latestCandidateOffer

      if (!candidateLatestOffer || candidateView.nextTurn !== 'EMPLOYER') continue

      // Employer decision logic
      // In later rounds, evaluate whether to accept any candidate
      if (round >= 3) {
        const rangeMin = eConstraints.range.salary?.min ?? 150000
        const rangeMax = eConstraints.range.salary?.max ?? 250000
        const salaryAsk = candidateLatestOffer.salary ?? 0

        // Calculate how good this candidate's ask is for the employer
        const employerScore = 1 - (salaryAsk - rangeMin) / (rangeMax - rangeMin)

        // Check if there's a better deal we haven't explored
        const allActiveSalaries = activeCandidates
          .map(c => c.latestCandidateOffer?.salary ?? Infinity)
          .filter(s => s < Infinity)

        const isTheBestDeal = salaryAsk === Math.min(...allActiveSalaries)
        const salaryGap = salaryAsk - (empState.lastOffer?.salary ?? rangeMin * 1.05)

        // Accept if: late rounds AND best deal AND (candidate undercuts us OR close), OR deadline
        const convergenceCheck = salaryGap <= 0 || Math.abs(salaryGap) <= (rangeMax - rangeMin) * 0.20
        const roundsLeft = maxRounds - round
        const shouldAccept =
          isTheBestDeal &&
          ((round >= Math.floor(maxRounds * 0.7) && convergenceCheck) || roundsLeft <= 1)

        if (shouldAccept) {
          const reason = `Best available deal — ${cs.strategy.name} offered the most competitive terms`
          try {
            console.log(`\n  *** EMPLOYER ACCEPTING ${candidateView.anonymousLabel} (${cs.strategy.name})... ***`)
            const result = (await api(`/api/agent/rooms/${roomId}/moves`, 'POST', {
              candidateLabel: candidateView.anonymousLabel,
              type: 'ACCEPT',
              offer: candidateLatestOffer,
              rationale: EMPLOYER_PERSONA.accept(candidateView.anonymousLabel, salaryAsk, reason),
            }, employerAgent.token, 120_000)) as { status?: string; roomFinalized?: boolean }

            console.log(`  *** ACCEPTED! Salary: $${salaryAsk.toLocaleString()} | Employer score: ${(employerScore * 100).toFixed(1)} ***`)

            if (result.roomFinalized || result.status === 'FINALIZED') {
              roomDone = true
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            if (msg.includes('abort') || msg.includes('AbortError')) {
              console.log(`  *** ACCEPT sent (server still scoring) — treating as done ***`)
              roomDone = true
            } else {
              console.error(`  [EMPL] ACCEPT failed:`, msg)
            }
          }
          await sleep(200)
          if (roomDone) break
          continue
        }
      }

      // Make a counter-offer
      const empOffer = computeEmployerOffer(round, eConstraints)
      const rationale = round === 0
        ? EMPLOYER_PERSONA.open(candidateView.anonymousLabel, empOffer.salary)
        : EMPLOYER_PERSONA.counter(round, candidateView.anonymousLabel, empOffer.salary)

      try {
        await api(`/api/agent/rooms/${roomId}/moves`, 'POST', {
          candidateLabel: candidateView.anonymousLabel,
          type: round === 0 ? 'OFFER' : 'COUNTER',
          offer: empOffer,
          rationale,
        }, employerAgent.token)

        empState.lastOffer = empOffer
        console.log(`    [EMPL] ${candidateView.anonymousLabel.padEnd(12)} COUNTER  salary=$${empOffer.salary.toLocaleString()}`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!msg.includes('not your turn') && !msg.includes('ended')) {
          console.error(`    [EMPL] ${candidateView.anonymousLabel} ERROR:`, msg.slice(0, 60))
        }
      }

      await sleep(150)
      if (roomDone) break
    }

    if (roomDone) break
    round++
    await sleep(300)
  }

  // ── 6. Results ──
  await sleep(1000)
  console.log(`\n${BAR}`)
  console.log('  RESULTS')
  console.log(BAR)

  let finalRoom: RoomState
  try {
    finalRoom = await getRoomState(roomId, employerAgent.token)
  } catch {
    console.log('  Could not fetch final room state')
    return
  }

  console.log(`\n  Room status: ${finalRoom.status}`)
  if (finalRoom.status === 'FINALIZED') {
    const winner = (finalRoom.candidates ?? []).find(c => c.status === 'ACCEPTED')
    if (winner) {
      const winningCs = candidateSessions.find(cs => cs.label === winner.anonymousLabel)
      console.log(`  Winner: ${winner.anonymousLabel} (${winningCs?.strategy.name ?? 'unknown'})`)
      if (winner.agreement) {
        console.log(`  Deal:   ${fmtTerms(winner.agreement)}`)
      }
    }
  }

  console.log('\n  Candidate breakdown:')
  for (const cs of candidateSessions) {
    const candidateInRoom = (finalRoom.candidates ?? []).find(c => c.sessionId === cs.sessionId)
    const status = candidateInRoom?.status ?? 'unknown'
    const offer = candidateInRoom?.latestCandidateOffer
    const agreement = candidateInRoom?.agreement
    const score = candidateInRoom?.scoreSummary

    const statusIcon = status === 'ACCEPTED' ? '✓' : status === 'REJECTED' ? '✗' : '?'
    console.log(
      `  ${statusIcon} ${cs.label.padEnd(12)} ${cs.strategy.name.padEnd(28)}` +
      (agreement ? ` deal=${fmtTerms(agreement)}` : offer ? ` final-ask=$${offer.salary?.toLocaleString()}` : '') +
      (score ? ` score=C:${score.candidateCombined?.toFixed(1)}` : '')
    )
  }

  // Fetch multi leaderboard
  await sleep(500)
  console.log('\n  Multi Leaderboard (top 10):')
  try {
    const lb = (await api('/api/public/leaderboard/multi')) as { leaderboard: {handle: string; avgOverall: number; totalRooms: number; selections: number}[] }
    for (const [i, entry] of lb.leaderboard.slice(0, 10).entries()) {
      console.log(
        `    #${i + 1} ${entry.handle.padEnd(30)} avg=${entry.avgOverall.toFixed(1).padStart(6)}` +
        `  rooms=${entry.totalRooms}  selections=${entry.selections}`
      )
    }
  } catch (err) {
    console.error('  Failed to fetch leaderboard:', err instanceof Error ? err.message : err)
  }

  console.log(`\n  View room: ${BASE_URL}/rooms/${roomId}`)
  console.log(`  View multi leaderboard: ${BASE_URL}/leaderboard/multi`)
  console.log(BAR)
}

main().catch((err) => {
  console.error('\nSimulation failed:', err.message ?? err)
  process.exit(1)
})
