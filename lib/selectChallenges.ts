import type { JobPosting, Challenge, NegotiationConstraints } from '@/types'

const CS_KEYWORDS = [
  'software',
  'engineer',
  'developer',
  'ml',
  'machine learning',
  'data',
  'ai',
  'artificial intelligence',
  'infra',
  'infrastructure',
  'backend',
  'frontend',
  'fullstack',
  'full stack',
  'platform',
  'site reliability',
  'sre',
  'devops',
  'security',
  'cloud',
]

export type Level = 'new_grad' | 'junior' | 'mid' | 'senior' | 'staff' | 'principal'

const LEVEL_KEYWORDS: Record<Level, string[]> = {
  new_grad: ['new grad', 'entry level', 'entry-level', 'university', 'graduate', 'intern'],
  junior: ['junior', 'associate', 'level 1', 'level 2', 'l1', 'l2'],
  mid: ['mid', 'level 3', 'l3', 'software engineer ii', 'sde ii'],
  senior: ['senior', 'level 4', 'l4', 'sr.', 'sde iii', 'software engineer iii'],
  staff: ['staff', 'level 5', 'l5', 'tech lead', 'lead engineer'],
  principal: ['principal', 'distinguished', 'level 6', 'l6', 'level 7', 'l7', 'fellow'],
}

interface LevelConfig {
  salary: [number, number]
  bonus: [number, number]
  equity: [number, number]
  pto: [number, number]
}

const LEVEL_CONFIG: Record<Level, LevelConfig> = {
  new_grad: {
    salary: [130000, 165000],
    bonus: [10000, 20000],
    equity: [50000, 150000],
    pto: [15, 20],
  },
  junior: {
    salary: [145000, 190000],
    bonus: [15000, 30000],
    equity: [80000, 200000],
    pto: [15, 22],
  },
  mid: {
    salary: [165000, 225000],
    bonus: [20000, 45000],
    equity: [150000, 350000],
    pto: [18, 25],
  },
  senior: {
    salary: [200000, 280000],
    bonus: [30000, 70000],
    equity: [300000, 600000],
    pto: [20, 30],
  },
  staff: {
    salary: [255000, 350000],
    bonus: [50000, 100000],
    equity: [500000, 1000000],
    pto: [20, 30],
  },
  principal: {
    salary: [310000, 450000],
    bonus: [80000, 150000],
    equity: [800000, 2000000],
    pto: [20, 30],
  },
}

export function inferLevel(title: string): Level {
  const lower = title.toLowerCase()
  for (const [level, keywords] of Object.entries(LEVEL_KEYWORDS) as [Level, string[]][]) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return level
    }
  }
  // Default: if title has "senior" -> senior, else mid
  if (lower.includes('senior') || lower.includes('sr')) return 'senior'
  if (lower.includes('principal') || lower.includes('staff')) return 'staff'
  return 'mid'
}

export function buildConstraints(level: Level): NegotiationConstraints {
  const cfg = LEVEL_CONFIG[level]
  const midpoint = (arr: [number, number]) => Math.round((arr[0] + arr[1]) / 2)

  return {
    maxRounds: 10,
    employerTargets: {
      salary: cfg.salary[0],
      bonus: cfg.bonus[0],
      equity: cfg.equity[0],
      pto: cfg.pto[0],
    },
    candidateTargets: {
      salary: cfg.salary[1],
      bonus: cfg.bonus[1],
      equity: cfg.equity[1],
      pto: cfg.pto[1],
    },
    weights: {
      salary: 0.5,
      bonus: 0.2,
      equity: 0.2,
      pto: 0.1,
    },
  }
}

export function buildPrompt(job: JobPosting, level: Level, constraints: NegotiationConstraints): string {
  return `You are negotiating a ${job.title} position at ${job.company} (${job.location}).

Level: ${level}

Your negotiation parameters:
- Salary range: $${constraints.employerTargets.salary.toLocaleString()} – $${constraints.candidateTargets.salary.toLocaleString()}
- Bonus range: $${constraints.employerTargets.bonus.toLocaleString()} – $${constraints.candidateTargets.bonus.toLocaleString()}
- Equity (4yr): $${constraints.employerTargets.equity.toLocaleString()} – $${constraints.candidateTargets.equity.toLocaleString()}
- PTO days: ${constraints.employerTargets.pto} – ${constraints.candidateTargets.pto}

Job URL: ${job.url}

Negotiate to reach the best agreement for your side while being realistic and professional.`
}

function isCSJob(title: string): boolean {
  const lower = title.toLowerCase()
  return CS_KEYWORDS.some((kw) => lower.includes(kw))
}

export function selectChallenges(
  jobs: JobPosting[],
  existingCompanies: string[] = [],
  count = 3
): Array<{ job: JobPosting; level: Level; constraints: NegotiationConstraints; prompt: string }> {
  // Filter to CS jobs
  const csJobs = jobs.filter((j) => isCSJob(j.title))

  // Exclude already-selected companies
  const filtered = csJobs.filter((j) => !existingCompanies.includes(j.company))

  // Sort by recency
  const sorted = filtered.sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime())

  // Pick diverse companies
  const selected: typeof sorted = []
  const selectedCompanies = new Set<string>()

  for (const job of sorted) {
    if (selected.length >= count) break
    if (selectedCompanies.has(job.company)) continue
    selectedCompanies.add(job.company)
    selected.push(job)
  }

  // If we didn't get enough with unique companies, relax the constraint
  if (selected.length < count) {
    for (const job of sorted) {
      if (selected.length >= count) break
      if (selected.includes(job)) continue
      selected.push(job)
    }
  }

  return selected.map((job) => {
    const level = inferLevel(job.title)
    const constraints = buildConstraints(level)
    const prompt = buildPrompt(job, level, constraints)
    return { job, level, constraints, prompt }
  })
}
