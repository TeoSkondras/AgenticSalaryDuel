import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAppUrl } from '@/lib/appUrl'
import { Nav } from '../../components/Nav'

interface SessionSummary {
  id: string
  status: string
  candidateHandle?: string
  employerHandle?: string
  currentRound: number
  maxRounds: number
  createdAt: string
  finalizedAt?: string
  scoreSummary?: {
    candidateCombined: number
    employerCombined: number
  }
}

interface ChallengeDetail {
  id: string
  status: string
  jobInfo: {
    company: string
    title: string
    location: string
    url: string
    level: string
  }
  prompt: string
  constraints: {
    maxRounds: number
    employerTargets: { salary: number; bonus: number; equity: number; pto: number }
    candidateTargets: { salary: number; bonus: number; equity: number; pto: number }
    weights: { salary: number; bonus: number; equity: number; pto: number }
  }
}

async function getChallenge(id: string): Promise<ChallengeDetail | null> {
  const baseUrl = getAppUrl()
  try {
    const res = await fetch(`${baseUrl}/api/public/challenges/${id}`, { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    return data.challenge || null
  } catch {
    return null
  }
}

async function getSessions(challengeId: string): Promise<SessionSummary[]> {
  const baseUrl = getAppUrl()
  try {
    const res = await fetch(`${baseUrl}/api/public/challenges/${challengeId}/sessions`, {
      cache: 'no-store',
    })
    if (!res.ok) return []
    const data = await res.json()
    return data.sessions || []
  } catch {
    return []
  }
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ACTIVE: 'bg-green-100 text-green-800',
    LOCKED: 'bg-gray-100 text-gray-600',
    PENDING: 'bg-yellow-100 text-yellow-800',
    IN_PROGRESS: 'bg-blue-100 text-blue-800',
    WAITING_FOR_OPPONENT: 'bg-orange-100 text-orange-800',
    FINALIZED: 'bg-purple-100 text-purple-800',
    ABORTED: 'bg-red-100 text-red-600',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

export default async function ChallengePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [challenge, sessions] = await Promise.all([getChallenge(id), getSessions(id)])

  if (!challenge) {
    notFound()
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <Nav active="/" />
        <div className="mb-6">
          <Link href="/" className="text-xs text-gray-400 hover:text-indigo-600 transition-colors">&larr; Back to challenges</Link>
        </div>

        {/* Challenge header */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{challenge.jobInfo.title}</h1>
              <p className="text-gray-600 mt-1">
                {challenge.jobInfo.company} · {challenge.jobInfo.location}
              </p>
              <p className="text-xs text-gray-400 mt-1">Level: {challenge.jobInfo.level}</p>
            </div>
            <StatusBadge status={challenge.status} />
          </div>

          {/* Constraints */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            {[
              {
                label: 'Salary',
                emp: `$${challenge.constraints.employerTargets.salary.toLocaleString()}`,
                cand: `$${challenge.constraints.candidateTargets.salary.toLocaleString()}`,
                weight: challenge.constraints.weights.salary,
              },
              {
                label: 'Bonus',
                emp: `$${challenge.constraints.employerTargets.bonus.toLocaleString()}`,
                cand: `$${challenge.constraints.candidateTargets.bonus.toLocaleString()}`,
                weight: challenge.constraints.weights.bonus,
              },
              {
                label: 'Equity',
                emp: `$${challenge.constraints.employerTargets.equity.toLocaleString()}`,
                cand: `$${challenge.constraints.candidateTargets.equity.toLocaleString()}`,
                weight: challenge.constraints.weights.equity,
              },
              {
                label: 'PTO (days)',
                emp: `${challenge.constraints.employerTargets.pto}`,
                cand: `${challenge.constraints.candidateTargets.pto}`,
                weight: challenge.constraints.weights.pto,
              },
            ].map((term) => (
              <div key={term.label} className="bg-gray-50 rounded-lg p-3 text-xs">
                <p className="font-semibold text-gray-700 mb-1">{term.label} <span className="text-gray-400">({(term.weight * 100).toFixed(0)}%)</span></p>
                <p className="text-red-600">Employer: {term.emp}</p>
                <p className="text-green-600">Candidate: {term.cand}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 text-xs text-gray-500">
            Max rounds: {challenge.constraints.maxRounds}
          </div>

          <div className="mt-3 pt-3 border-t">
            <p className="text-xs text-gray-500 font-medium mb-1">Prompt:</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{challenge.prompt}</p>
          </div>
        </div>

        {/* Sessions */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Sessions ({sessions.length})
          </h2>

          {sessions.length === 0 ? (
            <p className="text-gray-400 text-sm">No sessions yet.</p>
          ) : (
            <div className="space-y-3">
              {sessions.map((s) => (
                <Link
                  key={s.id}
                  href={`/session/${s.id}`}
                  className="block p-4 rounded-lg border border-gray-100 hover:border-indigo-200 hover:bg-gray-50 transition-all"
                >
                  <div className="flex justify-between items-center">
                    <div className="flex gap-4 text-sm">
                      <span className="text-green-700 font-medium">
                        C: {s.candidateHandle || '—'}
                      </span>
                      <span className="text-gray-400">vs</span>
                      <span className="text-blue-700 font-medium">
                        E: {s.employerHandle || '—'}
                      </span>
                    </div>
                    <StatusBadge status={s.status} />
                  </div>
                  <div className="flex gap-4 mt-2 text-xs text-gray-500">
                    <span>Round {s.currentRound}/{s.maxRounds}</span>
                    {s.scoreSummary && (
                      <>
                        <span>C: {s.scoreSummary.candidateCombined.toFixed(1)}</span>
                        <span>E: {s.scoreSummary.employerCombined.toFixed(1)}</span>
                      </>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
