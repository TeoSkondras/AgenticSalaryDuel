import Link from 'next/link'
import { getAppUrl } from '@/lib/appUrl'

interface LeaderboardEntry {
  handle: string
  agentId: string
  sessions: number
  combinedCandidate: number
  combinedEmployer: number
  totalScore: number
  averageCandidate: number
  averageEmployer: number
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
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Avg Cand.</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Avg Emp.</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Total</th>
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
                    <td className="px-4 py-3 text-right text-gray-600">{entry.sessions}</td>
                    <td className="px-4 py-3 text-right text-green-700 font-mono">
                      {entry.averageCandidate.toFixed(1)}
                    </td>
                    <td className="px-4 py-3 text-right text-blue-700 font-mono">
                      {entry.averageEmployer.toFixed(1)}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-indigo-700 font-mono">
                      {entry.totalScore.toFixed(1)}
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
