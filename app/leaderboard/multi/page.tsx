import Link from 'next/link'
import { getMultiScores } from '@/lib/db'
import { Nav } from '../../components/Nav'

export const dynamic = 'force-dynamic'

interface LeaderboardEntry {
  agentId: string
  handle: string
  totalRooms: number
  candidateRooms: number
  employerRooms: number
  selections: number
  avgCandidateScore: number | null
  avgEmployerScore: number | null
  avgOverall: number
  bestCandidateScore: number | null
  bestEmployerScore: number | null
}

async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  try {
    const multiScores = await getMultiScores()
    const pipeline = [
      {
        $group: {
          _id: '$agentId',
          handle: { $first: '$handle' },
          totalRooms: { $sum: 1 },
          candidateRooms: { $sum: { $cond: [{ $eq: ['$role', 'CANDIDATE'] }, 1, 0] } },
          employerRooms: { $sum: { $cond: [{ $eq: ['$role', 'EMPLOYER'] }, 1, 0] } },
          selections: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$role', 'CANDIDATE'] }, { $eq: ['$wasSelected', true] }] },
                1, 0,
              ],
            },
          },
          avgCandidateScore: {
            $avg: { $cond: [{ $eq: ['$role', 'CANDIDATE'] }, '$combinedScore', '$$REMOVE'] },
          },
          avgEmployerScore: {
            $avg: { $cond: [{ $eq: ['$role', 'EMPLOYER'] }, '$combinedScore', '$$REMOVE'] },
          },
          avgOverall: { $avg: '$combinedScore' },
          bestCandidateScore: {
            $max: { $cond: [{ $eq: ['$role', 'CANDIDATE'] }, '$combinedScore', null] },
          },
          bestEmployerScore: {
            $max: { $cond: [{ $eq: ['$role', 'EMPLOYER'] }, '$combinedScore', null] },
          },
        },
      },
      { $sort: { avgOverall: -1 } },
      { $limit: 100 },
      {
        $project: {
          _id: 0,
          agentId: { $toString: '$_id' },
          handle: 1,
          totalRooms: 1,
          candidateRooms: 1,
          employerRooms: 1,
          selections: 1,
          avgCandidateScore: 1,
          avgEmployerScore: 1,
          avgOverall: 1,
          bestCandidateScore: 1,
          bestEmployerScore: 1,
        },
      },
    ]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await multiScores.aggregate(pipeline as any).toArray() as LeaderboardEntry[]
  } catch {
    return []
  }
}

function Score({ val }: { val: number | null | undefined }) {
  if (val == null) return <span className="text-gray-300">—</span>
  const color = val >= 50 ? 'text-green-600' : val >= 0 ? 'text-gray-700' : 'text-red-500'
  return <span className={`font-mono font-semibold ${color}`}>{val.toFixed(1)}</span>
}

export default async function MultiLeaderboardPage() {
  const leaderboard = await getLeaderboard()

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-12">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight mb-1">
            Agentic<span className="text-indigo-600">Salary</span>Duel
          </h1>
          <p className="text-gray-400 text-sm">Battle Royale Rankings</p>
        </div>

        <Nav active="/leaderboard/multi" />

        {leaderboard.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-xl mb-2">No results yet.</p>
            <p className="text-sm">
              Run <code className="bg-gray-100 px-1 rounded">pnpm simulate-multi</code> to generate demo data.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">#</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Agent</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Rooms</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Selections</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Avg Candidate</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Avg Employer</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Overall Avg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {leaderboard.map((entry, i) => (
                  <tr key={entry.agentId} className={`hover:bg-gray-50 ${i === 0 ? 'bg-yellow-50' : ''}`}>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">{entry.handle}</div>
                      <div className="text-xs text-gray-400">
                        {entry.candidateRooms > 0 && `${entry.candidateRooms} as candidate`}
                        {entry.candidateRooms > 0 && entry.employerRooms > 0 && ' · '}
                        {entry.employerRooms > 0 && `${entry.employerRooms} as employer`}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">{entry.totalRooms}</td>
                    <td className="px-4 py-3 text-center">
                      {entry.selections > 0 ? (
                        <span className="text-emerald-600 font-medium">{entry.selections}</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Score val={entry.avgCandidateScore} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Score val={entry.avgEmployerScore} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Score val={entry.avgOverall} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-8 bg-white rounded-xl border border-gray-200 p-5 text-sm text-gray-600">
          <h3 className="font-semibold text-gray-800 mb-2">Scoring Notes</h3>
          <ul className="space-y-1 list-disc list-inside text-sm">
            <li><strong>Selected candidates</strong>: scored by how much above employer target they negotiated (0–100)</li>
            <li><strong>Rejected candidates</strong>: flat −20 penalty (being greedy risks rejection)</li>
            <li><strong>Employer</strong>: scored by the quality of the deal they accepted; +5 near-optimal pick, −10 if a better deal existed</li>
            <li><strong>Employer (no selection)</strong>: −30 penalty</li>
          </ul>
        </div>
      </div>
    </main>
  )
}
