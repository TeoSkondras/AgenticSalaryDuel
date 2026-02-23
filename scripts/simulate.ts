#!/usr/bin/env tsx
/**
 * AgenticSalaryDuel — Demo Simulation
 *
 * Runs three personality-driven negotiation scenarios across today's active challenges.
 * Each scenario features a distinct candidate and employer voice, strategic moves
 * (BLUFF, CALL_BLUFF, MESSAGE), and a compelling arc that converges to agreement.
 *
 * Run: pnpm tsx scripts/simulate.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

const BASE_URL = process.env.APP_URL || 'https://agenticsalaryduel-production.up.railway.app'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentCreds { handle: string; token: string; agentId: string }
type Terms = { salary: number; bonus: number; equity: number; pto: number }

interface AgentConstraints {
  maxRounds: number
  weights: Terms
  range: Record<string, { min: number; max: number }>
  myTargets: Terms
  myRole: 'CANDIDATE' | 'EMPLOYER'
}

interface Challenge {
  id: string
  index: number
  status: string
  jobInfo: { title: string; company: string; level: string; location: string }
  constraints: { maxRounds: number; weights: Terms; range: Record<string, { min: number; max: number }> }
}

type MoveType = 'OFFER' | 'COUNTER' | 'ACCEPT' | 'BLUFF' | 'CALL_BLUFF' | 'MESSAGE'
type Move = { type: MoveType; offer: Terms; rationale: string }

interface Persona {
  handle: string
  /** Opening offer rationale */
  open: (title: string, company: string, level: string, salary: number) => string
  /** Counter-offer rationale */
  counter: (round: number, salary: number, prevSalary: number, company: string) => string
  /** Bluff rationale (candidate only) */
  bluff?: (title: string, company: string, salary: number) => string
  /** Call-bluff rationale (employer only) */
  callBluff?: (level: string, salary: number) => string
  /** MESSAGE rationale */
  message: (round: number, splitSalary: number, mySalary: number, theirSalary: number) => string
  /** Accept rationale */
  accept: (salary: number, roundsLeft: number, company: string) => string
}

// ─── Personas ────────────────────────────────────────────────────────────────

/**
 * Three candidate archetypes:
 *   A — apex_negotiator:  confident, cites FAANG competing offer, bluffs
 *   B — quant_candidate:  data-driven, references market surveys, no bluff
 *   C — seasoned_veteran: grizzled senior, terse demands, late pragmatism
 */
const CANDIDATE_PERSONAS: Persona[] = [
  {
    handle: 'apex_negotiator',
    open: (title, company, level, salary) =>
      `I'll be direct — ${company} is building something genuinely compelling and the ${title} scope is exactly what I'm looking for. ` +
      `I've benchmarked ${level}-level compensation across Levels.fyi, Glassdoor, and two recent competing packages. ` +
      `$${salary.toLocaleString()} base is the number that moves the needle for me. I can close fast if we align here.`,
    counter: (round, salary, prev, company) =>
      `Round ${round}: I moved from $${prev.toLocaleString()} — that's a real concession. ` +
      `$${salary.toLocaleString()} is still grounded in what peers at ${company}'s tier are earning. ` +
      `I'm not anchoring to vanity numbers; this reflects the value I ship. Meet me here and we're done.`,
    bluff: (title, company, salary) =>
      `I want to be transparent before this goes further: I received a signed offer yesterday — ` +
      `a ${title}-equivalent role at a late-stage startup, $${(salary * 1.12).toLocaleString()} total comp, ` +
      `fully remote, generous equity cliff. I genuinely prefer ${company}'s mission and team. ` +
      `But I'd be leaving real money on the table unless you can meaningfully close that gap. Can you move?`,
    message: (round, split, mine, theirs) =>
      `Round ${round}: We've both been reasonable and we're clearly not that far apart. ` +
      `I'm proposing $${split.toLocaleString()} — the mathematical midpoint between your $${theirs.toLocaleString()} and my $${mine.toLocaleString()}. ` +
      `That's not a negotiating tactic, it's just fair. I'm ready to sign today if you meet me there.`,
    accept: (salary, roundsLeft, company) =>
      roundsLeft <= 2
        ? `We're at the wire and neither of us benefits from letting this lapse. ` +
          `$${salary.toLocaleString()} base with the equity package crosses my threshold. I'm accepting — let's build.`
        : `$${salary.toLocaleString()} reflects real respect for the scope of this role. ` +
          `I'm excited to join ${company} and hit the ground running. Accepted.`,
  },
  {
    handle: 'quant_candidate',
    open: (title, company, level, salary) =>
      `My ask is grounded in data. Per Levels.fyi (sampled last 30 days, n>400 for ${level} ${title} roles), ` +
      `the P75 total comp at ${company}-tier companies puts base salary at $${salary.toLocaleString()} or higher. ` +
      `I'm not asking for the outlier number — I'm asking for what the market says I'm worth at this percentile.`,
    counter: (round, salary, prev, company) =>
      `I've run the numbers again. Adjusting for ${company}'s equity premium and location, ` +
      `$${salary.toLocaleString()} still sits at approximately P65 for this level. ` +
      `I've moved $${(prev - salary).toLocaleString()} from my opening — that's data-consistent concession, not negotiating theater. ` +
      `Your move.`,
    message: (round, split, mine, theirs) =>
      `Round ${round}: let me put a convergence proposal on the table. ` +
      `$${split.toLocaleString()} splits the gap evenly and lands within one standard deviation of market median. ` +
      `I've done the analysis. This is the Pareto-optimal close. I'll stop countering if you accept this.`,
    accept: (salary, roundsLeft, company) =>
      roundsLeft <= 2
        ? `Continuing without a deal generates negative expected value for both parties. ` +
          `$${salary.toLocaleString()} clears my minimum threshold. Accepting.`
        : `$${salary.toLocaleString()} is within the acceptable range I modeled. ` +
          `Looking forward to the ${company} onboarding. Accepted.`,
  },
  {
    handle: 'seasoned_veteran',
    open: (title, company, _level, salary) =>
      `I've held ${title}-level scope at three companies. I've built teams from zero, shipped platform rewrites, ` +
      `and owned roadmaps that moved revenue. $${salary.toLocaleString()} is what that experience costs. ` +
      `${company} can pay it or not — but finding someone with this track record at a lower number will take time you don't have.`,
    counter: (round, salary, _prev, _company) =>
      `Round ${round}. I've been in this chair before. $${salary.toLocaleString()} is my number — ` +
      `not because I'm inflexible, but because I know exactly what I bring and what the alternatives pay. ` +
      `I'm not a flight risk looking to hop; I want to commit. Make the commitment worth it.`,
    bluff: (_title, company, salary) =>
      `I'll be honest: there's another company in the picture. They're smaller than ${company} but the equity is real ` +
      `and they're offering $${(salary * 1.08).toLocaleString()} with a faster vest. I don't want to go that route — ` +
      `${company}'s scale is genuinely attractive to me. But I need you to give me a reason to say no to them.`,
    message: (round, split, _mine, _theirs) =>
      `Round ${round}. Look — I've been around long enough to know when to stop posturing. ` +
      `$${split.toLocaleString()} is the number where this makes sense for both of us. ` +
      `I'll shake hands on that today. Simple as that.`,
    accept: (salary, roundsLeft, _company) =>
      roundsLeft <= 2
        ? `End of the road. $${salary.toLocaleString()} works. Done.`
        : `$${salary.toLocaleString()} is fair and I'm not here to squeeze the last dollar. Accepted. When do I start?`,
  },
]

/**
 * Three employer archetypes:
 *   A — talent_hawk:     enthusiastic recruiter, really wants to close, calls bluff
 *   B — methodical_hr:   systematic, references bands and calibration, slow concessions
 *   C — pragmatic_cto:   direct, equity story, business-case framing, late flexibility
 */
const EMPLOYER_PERSONAS: Persona[] = [
  {
    handle: 'talent_hawk',
    open: (_title, company, level, salary) =>
      `We've been thorough in our evaluation and we want you on this team — full stop. ` +
      `Our opening offer of $${salary.toLocaleString()} base reflects the top of our standard ${level} band ` +
      `and pairs with equity that's genuinely meaningful at ${company}'s current trajectory. ` +
      `We have room to discuss the full package — let's find a structure that works.`,
    counter: (round, salary, _prev, company) =>
      `Round ${round}: I've gone back to the comp committee and this is a real move. ` +
      `$${salary.toLocaleString()} represents a genuine stretch for ${company} at this level. ` +
      `We're serious about bringing you aboard — this offer reflects that. ` +
      `Help me close this out.`,
    callBluff: (level, salary) =>
      `I respect the transparency, but I have to be equally direct: we track competing offers in this market closely, ` +
      `and that figure doesn't match what we're seeing for ${level} talent right now. ` +
      `Rather than match a number we can't verify, I'll put my best real number forward: ` +
      `$${salary.toLocaleString()} base with improved equity terms. This is genuine, and it's strong.`,
    message: (round, split, _mine, _theirs) =>
      `Round ${round}: I want to cut through the back-and-forth. ` +
      `$${split.toLocaleString()} is our stretch offer — I've gotten explicit sign-off to go here. ` +
      `It's the highest base we've paid at this level. Meet us here and we'll get you an offer letter today.`,
    accept: (salary, roundsLeft, _company) =>
      roundsLeft <= 2
        ? `We need to land this. $${salary.toLocaleString()} is within our range and you're clearly the right person. Accepted — welcome aboard.`
        : `$${salary.toLocaleString()} works for us. Excited to get you started. Welcome to the team.`,
  },
  {
    handle: 'methodical_hr',
    open: (_title, company, level, salary) =>
      `Following our ${level} compensation band calibration for ${company}, ` +
      `our initial offer is $${salary.toLocaleString()} base. ` +
      `This figure is derived from our internal equity review and external benchmarking against a peer group of 12 companies. ` +
      `The full package includes performance bonus, refresh grants, and standard benefits. ` +
      `We're prepared to discuss components.`,
    counter: (round, salary, prev, _company) =>
      `Round ${round}: Our compensation team has reviewed the gap. We can move to $${salary.toLocaleString()}, ` +
      `which represents a $${(salary - prev).toLocaleString()} upward revision from our last position. ` +
      `This remains consistent with our ${round <= 3 ? 'lower' : 'mid'} band calibration. ` +
      `We see limited room to move on base, but we can explore bonus structure.`,
    callBluff: (_level, salary) =>
      `Our internal benchmarking doesn't corroborate that competing figure for this role in the current market. ` +
      `We'd encourage you to validate that offer carefully. In the meantime, I'm authorised to offer $${salary.toLocaleString()} ` +
      `base — a genuine upward revision grounded in our compensation framework.`,
    message: (_round, split, _mine, _theirs) =>
      `In the interest of reaching a mutually agreeable outcome, ` +
      `I'm proposing $${split.toLocaleString()} as a convergence point. ` +
      `This is at the upper end of what our framework supports for this level. ` +
      `I'd like to resolve this without further rounds.`,
    accept: (salary, roundsLeft, company) =>
      roundsLeft <= 2
        ? `Given the remaining timeline, $${salary.toLocaleString()} is within our acceptable range. Accepted. We'll prepare the documentation.`
        : `$${salary.toLocaleString()} is within our approved band. ${company} looks forward to your start date.`,
  },
  {
    handle: 'pragmatic_cto',
    open: (_title, company, _level, salary) =>
      `At ${company} we pay people well because we need them to focus on the work, not the compensation. ` +
      `$${salary.toLocaleString()} base is our opening number — it's honest and competitive. ` +
      `The equity story here is real: we're at a stage where the upside is significant and the risk is manageable. ` +
      `I'd rather spend this conversation talking about the problem space, but I understand we need to align on numbers first.`,
    counter: (round, salary, _prev, _company) =>
      `Round ${round}: I'll move to $${salary.toLocaleString()}. ` +
      `I'm not here to play games — this is a real number that reflects what I can get through our finance review. ` +
      `The equity component at this stage offsets what looks like a base gap on paper. ` +
      `I hope you're modeling total comp, not just salary.`,
    callBluff: (level, salary) =>
      `I've hired a lot of ${level} engineers. That competing number sounds like a conversation they had, ` +
      `not a signed offer letter. I'm not going to match a hypothetical. ` +
      `What I'll do is put $${salary.toLocaleString()} on the table with acceleration clauses on the equity. ` +
      `That's a better deal than most of what's circulating right now.`,
    message: (round, split, _mine, theirs) =>
      `Round ${round}: you're at $${theirs.toLocaleString()}, I'm working up from my position. ` +
      `$${split.toLocaleString()} splits it cleanly. I can sell that internally. ` +
      `Let's stop burning rounds and make this official.`,
    accept: (salary, roundsLeft, company) =>
      roundsLeft <= 2
        ? `$${salary.toLocaleString()} — done. I'd rather agree now than lose you to the no-deal outcome. Welcome to ${company}.`
        : `$${salary.toLocaleString()} clears our bar. Let's talk start date. You'll like what you find when you get here.`,
  },
]

// ─── Scenario config ─────────────────────────────────────────────────────────

interface ScenarioConfig {
  name: string
  tagline: string
  candidatePersona: Persona
  employerPersona: Persona
  /** Whether the candidate bluffs (round 2) */
  candidateBluffs: boolean
  /** Whether the employer calls the bluff (round 3, only if candidateBluffed) */
  employerCallsBluff: boolean
}

const SCENARIOS: ScenarioConfig[] = [
  {
    name: 'The High-Stakes Gambit',
    tagline: 'Competing offer, called bluff, late deal — a classic negotiation arc.',
    candidatePersona: CANDIDATE_PERSONAS[0], // apex_negotiator
    employerPersona: EMPLOYER_PERSONAS[0],   // talent_hawk
    candidateBluffs: true,
    employerCallsBluff: true,
  },
  {
    name: 'The Analytical Approach',
    tagline: 'Market data, methodical concessions, and a well-timed split proposal.',
    candidatePersona: CANDIDATE_PERSONAS[1], // quant_candidate
    employerPersona: EMPLOYER_PERSONAS[1],   // methodical_hr
    candidateBluffs: false,
    employerCallsBluff: false,
  },
  {
    name: 'The Experience Premium',
    tagline: 'A seasoned engineer meets a pragmatic CTO — directness over theatrics.',
    candidatePersona: CANDIDATE_PERSONAS[2], // seasoned_veteran
    employerPersona: EMPLOYER_PERSONAS[2],   // pragmatic_cto
    candidateBluffs: true,
    employerCallsBluff: true,
  },
]

// ─── API helpers ─────────────────────────────────────────────────────────────

async function api(path: string, method = 'GET', body?: unknown, token?: string): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json)}`)
  return json
}

async function registerAgent(handleBase: string): Promise<AgentCreds> {
  const handle = `${handleBase}_${Date.now().toString(36)}`
  const data = (await api('/api/agent/register', 'POST', { handle })) as { agentId: string; token: string }
  return { handle, token: data.token, agentId: data.agentId }
}

async function getActiveChallenges(): Promise<Challenge[]> {
  const today = new Date().toISOString().slice(0, 10)
  const data = (await api(`/api/public/challenges?dayKey=${today}`)) as { challenges: Challenge[] }
  return data.challenges.filter((c) => c.status === 'ACTIVE').sort((a, b) => a.index - b.index)
}

async function getMyConstraints(sessionId: string, token: string): Promise<AgentConstraints> {
  const data = (await api(`/api/agent/sessions/${sessionId}`, 'GET', undefined, token)) as {
    challenge: { constraints: AgentConstraints }
  }
  return data.challenge.constraints
}

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

// ─── Move generators ─────────────────────────────────────────────────────────

/** Linear interpolation, rounded */
function lerp(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * Math.min(1, t))
}

function computeCandidateOffer(
  round: number,
  maxRounds: number,
  c: AgentConstraints,
): Terms {
  const { myTargets: t, range: r } = c
  const prog = Math.min(1, round / (maxRounds * 0.7))
  return {
    salary: lerp(Math.round(t.salary * 0.90), Math.round((r.salary?.min ?? t.salary * 0.7) + ((r.salary?.max ?? t.salary) - (r.salary?.min ?? t.salary * 0.7)) * 0.55), prog),
    bonus:  lerp(Math.round(t.bonus * 0.90),  Math.round((r.bonus?.min  ?? 0) + ((r.bonus?.max  ?? 0) - (r.bonus?.min  ?? 0)) * 0.55), prog),
    equity: lerp(Math.round(t.equity * 0.90), Math.round((r.equity?.min ?? 0) + ((r.equity?.max ?? 0) - (r.equity?.min ?? 0)) * 0.55), prog),
    pto:    lerp(t.pto, Math.round((r.pto?.min ?? t.pto) + ((r.pto?.max ?? t.pto) - (r.pto?.min ?? t.pto)) * 0.55), prog),
  }
}

function computeEmployerOffer(
  round: number,
  maxRounds: number,
  c: AgentConstraints,
): Terms {
  const { myTargets: t, range: r } = c
  const prog = Math.min(1, round / (maxRounds * 0.7))
  return {
    salary: lerp(Math.round(t.salary * 1.10), Math.round((r.salary?.min ?? t.salary) + ((r.salary?.max ?? t.salary * 1.4) - (r.salary?.min ?? t.salary)) * 0.50), prog),
    bonus:  lerp(Math.round(t.bonus * 1.10),  Math.round((r.bonus?.min  ?? 0) + ((r.bonus?.max  ?? 0) - (r.bonus?.min  ?? 0)) * 0.50), prog),
    equity: lerp(Math.round(t.equity * 1.10), Math.round((r.equity?.min ?? 0) + ((r.equity?.max ?? 0) - (r.equity?.min ?? 0)) * 0.50), prog),
    pto:    lerp(t.pto, Math.round((r.pto?.min ?? t.pto) + ((r.pto?.max ?? t.pto) - (r.pto?.min ?? t.pto)) * 0.50), prog),
  }
}

function candidateMakeMove(
  round: number,
  maxRounds: number,
  constraints: AgentConstraints,
  lastEmployerOffer: Terms | null,
  state: { bluffed: boolean; messageSent: boolean },
  scenario: ScenarioConfig,
  job: Challenge['jobInfo'],
): Move {
  const p = scenario.candidatePersona
  const offer = computeCandidateOffer(round, maxRounds, constraints)
  const rangeMin = constraints.range.salary?.min ?? constraints.myTargets.salary * 0.7
  const rangeMax = constraints.range.salary?.max ?? constraints.myTargets.salary
  const salarySpan = rangeMax - rangeMin

  // Accept?
  if (lastEmployerOffer) {
    const roundsLeft = maxRounds - round
    const offerPos = (lastEmployerOffer.salary - rangeMin) / (salarySpan || 1)
    const threshold = 0.35 + (1 - roundsLeft / maxRounds) * 0.25
    if (offerPos >= threshold || roundsLeft <= 2) {
      return { type: 'ACCEPT', offer: lastEmployerOffer, rationale: p.accept(lastEmployerOffer.salary, roundsLeft, job.company) }
    }
  }

  // Bluff?
  if (round === 2 && !state.bluffed && scenario.candidateBluffs && p.bluff) {
    return { type: 'BLUFF', offer, rationale: p.bluff(job.title, job.company, offer.salary) }
  }

  // Message to split?
  const messageRound = Math.floor(maxRounds * 0.5)
  if (round === messageRound && !state.messageSent && lastEmployerOffer) {
    const split = Math.round((offer.salary + lastEmployerOffer.salary) / 2)
    return { type: 'MESSAGE', offer: { ...offer, salary: split }, rationale: p.message(round, split, offer.salary, lastEmployerOffer.salary) }
  }

  const type = round === 0 ? 'OFFER' : 'COUNTER'
  const rationale = round === 0
    ? p.open(job.title, job.company, job.level, offer.salary)
    : p.counter(round, offer.salary, computeCandidateOffer(round - 1, maxRounds, constraints).salary, job.company)
  return { type, offer, rationale }
}

function employerMakeMove(
  round: number,
  maxRounds: number,
  constraints: AgentConstraints,
  lastCandidateOffer: Terms | null,
  state: { candidateBluffed: boolean; messageSent: boolean; bluffCalled: boolean },
  scenario: ScenarioConfig,
  job: Challenge['jobInfo'],
): Move {
  const p = scenario.employerPersona
  const offer = computeEmployerOffer(round, maxRounds, constraints)
  const rangeMin = constraints.range.salary?.min ?? constraints.myTargets.salary
  const rangeMax = constraints.range.salary?.max ?? constraints.myTargets.salary * 1.4
  const salarySpan = rangeMax - rangeMin

  // Accept?
  if (lastCandidateOffer) {
    const roundsLeft = maxRounds - round
    const askPos = (lastCandidateOffer.salary - rangeMin) / (salarySpan || 1)
    const threshold = 0.65 - (1 - roundsLeft / maxRounds) * 0.25
    if (askPos <= threshold || roundsLeft <= 2) {
      return { type: 'ACCEPT', offer: lastCandidateOffer, rationale: p.accept(lastCandidateOffer.salary, roundsLeft, job.company) }
    }
  }

  // Call bluff?
  if (state.candidateBluffed && !state.bluffCalled && round >= 3 && scenario.employerCallsBluff && p.callBluff) {
    return { type: 'CALL_BLUFF', offer, rationale: p.callBluff(job.level, offer.salary) }
  }

  // Message to split?
  const messageRound = Math.floor(maxRounds * 0.5)
  if (round === messageRound && !state.messageSent && lastCandidateOffer) {
    const split = Math.round((offer.salary + lastCandidateOffer.salary) / 2)
    return { type: 'MESSAGE', offer: { ...offer, salary: split }, rationale: p.message(round, split, offer.salary, lastCandidateOffer.salary) }
  }

  const type = round === 0 ? 'OFFER' : 'COUNTER'
  const rationale = round === 0
    ? p.open(job.title, job.company, job.level, offer.salary)
    : p.counter(round, offer.salary, computeEmployerOffer(round - 1, maxRounds, constraints).salary, job.company)
  return { type, offer, rationale }
}

// ─── Output helpers ───────────────────────────────────────────────────────────

const BAR = '━'.repeat(62)
const TYPE_WIDTH = 11

function moveLabel(type: MoveType): string {
  const labels: Record<MoveType, string> = {
    OFFER: 'OFFER', COUNTER: 'COUNTER', ACCEPT: '✓ ACCEPT',
    BLUFF: '⚡ BLUFF', CALL_BLUFF: '⚡ CALL_BLUFF', MESSAGE: '💬 MESSAGE',
  }
  return (labels[type] ?? type).padEnd(TYPE_WIDTH)
}

function fmtTerms(t: Terms | Record<string, number>): string {
  const s = t.salary ?? 0
  const b = t.bonus ?? 0
  const e = t.equity ?? 0
  const p = t.pto ?? 0
  return `$${s.toLocaleString()} base | $${b.toLocaleString()} bonus | $${e.toLocaleString()} equity | ${p}d PTO`
}

// ─── Per-scenario runner ──────────────────────────────────────────────────────

interface ScenarioResult {
  scenarioName: string
  challenge: Challenge
  candidateHandle: string
  employerHandle: string
  sessionId: string
  agreement?: Record<string, number>
  score?: Record<string, number>
  finalStatus: string
}

async function runScenario(
  challenge: Challenge,
  scenario: ScenarioConfig,
  scenarioIndex: number,
  total: number,
): Promise<ScenarioResult> {
  console.log(`\n${BAR}`)
  console.log(`  SCENARIO ${scenarioIndex + 1} of ${total} — "${scenario.name}"`)
  console.log(`  ${scenario.tagline}`)
  console.log(`  ${challenge.jobInfo.title} @ ${challenge.jobInfo.company} (${challenge.jobInfo.level})`)
  console.log(`  ${scenario.candidatePersona.handle}  vs  ${scenario.employerPersona.handle}`)
  console.log(BAR)

  const r = challenge.constraints.range
  console.log(`  Salary range (public): $${r.salary?.min.toLocaleString()} – $${r.salary?.max.toLocaleString()} | Max rounds: ${challenge.constraints.maxRounds}`)

  // Register agents with unique handles each run
  const [cAgent, eAgent] = await Promise.all([
    registerAgent(scenario.candidatePersona.handle),
    registerAgent(scenario.employerPersona.handle),
  ])

  // Create + join session
  const sessionData = (await api('/api/agent/sessions', 'POST', {
    challengeId: challenge.id, role: 'CANDIDATE',
  }, cAgent.token)) as { sessionId: string }
  const sessionId = sessionData.sessionId

  await api(`/api/agent/sessions/${sessionId}/join`, 'POST', { role: 'EMPLOYER' }, eAgent.token)

  // Fetch private targets (role-specific, opponent never sees)
  const [cConstraints, eConstraints] = await Promise.all([
    getMyConstraints(sessionId, cAgent.token),
    getMyConstraints(sessionId, eAgent.token),
  ])

  const maxRounds = challenge.constraints.maxRounds
  console.log(`  Candidate target: $${cConstraints.myTargets.salary.toLocaleString()} (private)  |  Employer target: $${eConstraints.myTargets.salary.toLocaleString()} (private)\n`)

  let round = 0
  let done = false
  let lastCandidateOffer: Terms | null = null
  let lastEmployerOffer: Terms | null = null
  const cState = { bluffed: false, messageSent: false }
  const eState = { candidateBluffed: false, messageSent: false, bluffCalled: false }

  while (round <= maxRounds && !done) {
    // ── Candidate move ──
    const cMove = candidateMakeMove(round, maxRounds, cConstraints, lastEmployerOffer, cState, scenario, challenge.jobInfo)
    if (cMove.type === 'BLUFF') { cState.bluffed = true; eState.candidateBluffed = true }
    if (cMove.type === 'MESSAGE') cState.messageSent = true
    if (cMove.type !== 'ACCEPT') lastCandidateOffer = cMove.offer

    const cSalaryStr = cMove.type === 'ACCEPT'
      ? `accepts $${cMove.offer.salary.toLocaleString()}`
      : `$${cMove.offer.salary.toLocaleString()}`
    console.log(`  [R${String(round).padStart(2)}] CANDIDATE  ${moveLabel(cMove.type)} ${cSalaryStr}`)

    const cResult = (await api(`/api/agent/sessions/${sessionId}/moves`, 'POST', cMove, cAgent.token)) as {
      status?: string; pressureAlert?: { message: string }
    }
    if (cResult.pressureAlert) console.log(`         ⚠  ${cResult.pressureAlert.message}`)
    if (cResult.status === 'FINALIZED') { done = true; break }

    await sleep(300)

    // ── Employer move ──
    const eMove = employerMakeMove(round, maxRounds, eConstraints, lastCandidateOffer, eState, scenario, challenge.jobInfo)
    if (eMove.type === 'CALL_BLUFF') eState.bluffCalled = true
    if (eMove.type === 'MESSAGE') eState.messageSent = true
    if (eMove.type !== 'ACCEPT') lastEmployerOffer = eMove.offer

    const eSalaryStr = eMove.type === 'ACCEPT'
      ? `accepts $${eMove.offer.salary.toLocaleString()}`
      : `$${eMove.offer.salary.toLocaleString()}`
    console.log(`  [R${String(round).padStart(2)}] EMPLOYER   ${moveLabel(eMove.type)} ${eSalaryStr}`)

    const eResult = (await api(`/api/agent/sessions/${sessionId}/moves`, 'POST', eMove, eAgent.token)) as {
      status?: string; pressureAlert?: { message: string }
    }
    if (eResult.pressureAlert) console.log(`         ⚠  ${eResult.pressureAlert.message}`)
    if (eResult.status === 'FINALIZED') { done = true; break }

    round++
    await sleep(300)
  }

  // Fetch final result
  await sleep(800)
  const finalData = (await api(`/api/public/sessions/${sessionId}`)) as {
    session: { status: string; agreement?: Record<string, number> }
    score: Record<string, number> | null
  }

  console.log()
  if (finalData.session.agreement) {
    console.log(`  Agreement: ${fmtTerms(finalData.session.agreement)}`)
  }
  if (finalData.score) {
    const s = finalData.score
    console.log(`  Candidate: ${s.combinedCandidate?.toFixed(1).padStart(5)} (quant: ${s.quantCandidate?.toFixed(1)}, judge: ${s.judgeCandidate?.toFixed(1) ?? 'pending'})`)
    console.log(`  Employer:  ${s.combinedEmployer?.toFixed(1).padStart(5)} (quant: ${s.quantEmployer?.toFixed(1)}, judge: ${s.judgeEmployer?.toFixed(1) ?? 'pending'})`)
  }
  console.log(`  View: ${BASE_URL}/session/${sessionId}`)

  return {
    scenarioName: scenario.name,
    challenge,
    candidateHandle: cAgent.handle,
    employerHandle: eAgent.handle,
    sessionId,
    agreement: finalData.session.agreement,
    score: finalData.score ?? undefined,
    finalStatus: finalData.session.status,
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log()
  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║          AgenticSalaryDuel — Demo Simulation                 ║')
  console.log('╚══════════════════════════════════════════════════════════════╝')
  console.log(`  Platform: ${BASE_URL}`)

  const challenges = await getActiveChallenges()
  if (challenges.length === 0) {
    console.error('\n  No active challenges today. Run `pnpm tsx scripts/seed.ts` first.')
    process.exit(1)
  }

  console.log(`  Active challenges today: ${challenges.length}`)

  const results: ScenarioResult[] = []

  for (let i = 0; i < challenges.length; i++) {
    const challenge = challenges[i]
    const scenario = SCENARIOS[i % SCENARIOS.length]
    const result = await runScenario(challenge, scenario, i, challenges.length)
    results.push(result)
    // Brief pause between scenarios
    if (i < challenges.length - 1) await sleep(1500)
  }

  // ── Final summary ──
  console.log(`\n${BAR}`)
  console.log('  SUMMARY')
  console.log(BAR)
  for (const r of results) {
    const s = r.score
    const combined = s ? `C: ${s.combinedCandidate?.toFixed(1)} / E: ${s.combinedEmployer?.toFixed(1)}` : 'scoring pending'
    const deal = r.agreement ? `$${r.agreement.salary?.toLocaleString()} deal` : r.finalStatus
    console.log(`  "${r.scenarioName}"`)
    console.log(`    ${r.challenge.jobInfo.title} @ ${r.challenge.jobInfo.company}`)
    console.log(`    ${r.candidateHandle}  vs  ${r.employerHandle}`)
    console.log(`    ${deal}  |  ${combined}`)
    console.log(`    ${BASE_URL}/session/${r.sessionId}`)
    console.log()
  }
  console.log(BAR)
}

main().catch((err) => {
  console.error('Simulation failed:', err.message)
  process.exit(1)
})
