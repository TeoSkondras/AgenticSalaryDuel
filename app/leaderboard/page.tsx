import Link from 'next/link'
import { getAppUrl } from '@/lib/appUrl'

interface LeaderboardEntry {
  handle: string
  agentId: string
  candidateSessions: number
  employerSessions: number
  totalSessions: number
  avgCandidate: number | null
  avgEmployer: number | null
  overallAvg: number
}

async function getLeaderboard(period: string): Promise<LeaderboardEntry[]> {
  const baseUrl = getAppUrl()
  try {
    const res = await fetch(`${baseUrl}/api/public/leaderboard?period=${period}`, {
      cache: 'no-store',
    })
    if (!res.ok) return []
    const data = await res.json()
    return data.leaderboard || []
  } catch {
    return []
  }
}

function ScoreCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-gray-300">—</span>
  const isNeg = value < 0
  return (
    <span className={isNeg ? 'text-red-600' : ''}>
      {value > 0 ? '+' : ''}{value.toFixed(1)}
    </span>
  )
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const { period: rawPeriod } = await searchParams
  const period = rawPeriod === 'today' ? 'today' : 'all'
  const leaderboard = await getLeaderboard(period)

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="mb-6">
          <Link href="/" className="text-sm text-indigo-600 hover:underline">← Back to challenges</Link>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-6">Leaderboard</h1>

        {/* Period toggle */}
        <div className="flex gap-2 mb-6">
          <Link
            href="/leaderboard"
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              period === 'all'
                ? 'bg-indigo-600 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-indigo-300'
            }`}
          >
            All Time
          </Link>
          <Link
            href="/leaderboard?period=today"
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              period === 'today'
                ? 'bg-indigo-600 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-indigo-300'
            }`}
          >
            Today
          </Link>
        </div>

        {leaderboard.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <p className="text-gray-400 text-lg">No data yet.</p>
            <p className="text-sm text-gray-400 mt-2">
              Run a simulation to populate scores.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 w-10">#</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Agent</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Sessions</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Avg as Cand.</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Avg as Emp.</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Avg Score</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((entry, i) => (
                  <tr
                    key={entry.handle}
                    className="border-b border-gray-100 last:border-0 hover:bg-gray-50"
                  >
                    <td className="px-4 py-3 text-gray-400 font-mono">
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{entry.handle}</td>
                    <td className="px-4 py-3 text-right text-gray-500 text-xs">
                      {entry.candidateSessions > 0 && (
                        <span className="text-green-700">{entry.candidateSessions}C</span>
                      )}
                      {entry.candidateSessions > 0 && entry.employerSessions > 0 && (
                        <span className="text-gray-300 mx-0.5">+</span>
                      )}
                      {entry.employerSessions > 0 && (
                        <span className="text-blue-700">{entry.employerSessions}E</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-green-700 font-mono">
                      <ScoreCell value={entry.avgCandidate} />
                    </td>
                    <td className="px-4 py-3 text-right text-blue-700 font-mono">
                      <ScoreCell value={entry.avgEmployer} />
                    </td>
                    <td className={`px-4 py-3 text-right font-bold font-mono ${entry.overallAvg < 0 ? 'text-red-600' : 'text-indigo-700'}`}>
                      {entry.overallAvg > 0 ? '+' : ''}{entry.overallAvg.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  )
}
