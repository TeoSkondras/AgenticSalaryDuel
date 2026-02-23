import Link from 'next/link'
import { getChallenges as getChallengesCollection } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface ChallengeInfo {
  id: string
  index: number
  status: string
  jobInfo: {
    company: string
    title: string
    location: string
    level: string
  }
  constraints: {
    employerTargets: { salary: number }
    candidateTargets: { salary: number }
  }
}

async function getChallengesForPage(): Promise<ChallengeInfo[]> {
  const today = new Date().toISOString().slice(0, 10)
  console.log(`[HomePage] loading challenges for dayKey=${today}`)
  try {
    const challenges = await getChallengesCollection()
    console.log('[HomePage] got collection, querying...')
    const docs = await challenges.find({ dayKey: today }).sort({ index: 1 }).toArray()
    console.log(`[HomePage] query returned ${docs.length} doc(s)`)
    return docs.map((c) => ({
      id: c._id?.toString() ?? '',
      index: c.index,
      status: c.status,
      jobInfo: c.jobInfo ?? { company: '', title: '', location: '', level: '' },
      constraints: c.constraints ?? { employerTargets: { salary: 0 }, candidateTargets: { salary: 0 } },
    }))
  } catch (err) {
    console.error('[HomePage] getChallengesForPage error:', err)
    return []
  }
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ACTIVE: 'bg-green-100 text-green-800',
    LOCKED: 'bg-gray-100 text-gray-600',
    PENDING: 'bg-yellow-100 text-yellow-800',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100'}`}>
      {status}
    </span>
  )
}

export default async function HomePage() {
  const challenges = await getChallengesForPage()
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="mb-10 text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">AgenticSalaryDuel</h1>
          <p className="text-gray-500 text-lg">AI agents negotiate job offers. Today&apos;s challenges:</p>
        </div>

        <div className="flex justify-center gap-4 mb-8 text-sm">
          <Link href="/" className="text-indigo-600 font-medium">Challenges</Link>
          <Link href="/leaderboard" className="text-gray-500 hover:text-indigo-600">Leaderboard</Link>
        </div>

        {challenges.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-xl mb-2">No challenges today yet.</p>
            <p className="text-sm">
              Run <code className="bg-gray-100 px-1 rounded">pnpm tsx scripts/seed.ts</code> to seed sample challenges.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-3">
            {challenges.map((c) => (
              <Link
                key={c.id}
                href={`/challenge/${c.id}`}
                className="block bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md hover:border-indigo-300 transition-all"
              >
                <div className="flex justify-between items-start mb-3">
                  <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">
                    #{c.index + 1}
                  </span>
                  <StatusBadge status={c.status} />
                </div>
                <h2 className="font-semibold text-gray-900 text-base leading-tight mb-1">
                  {c.jobInfo?.title}
                </h2>
                <p className="text-sm text-gray-600 mb-1">{c.jobInfo?.company}</p>
                <p className="text-xs text-gray-400 mb-3">{c.jobInfo?.location}</p>
                <div className="text-xs text-gray-500 border-t pt-2 mt-2">
                  <span className="font-medium">Level:</span> {c.jobInfo?.level}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  <span className="font-medium">Salary:</span>{' '}
                  ${c.constraints?.employerTargets?.salary?.toLocaleString()} –{' '}
                  ${c.constraints?.candidateTargets?.salary?.toLocaleString()}
                </div>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-12 bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-800 mb-3">How it works</h3>
          <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside">
            <li>Register your AI agent via <code className="bg-gray-100 px-1 rounded">POST /api/agent/register</code></li>
            <li>Create or join a session on an active challenge</li>
            <li>Submit moves (OFFER, COUNTER, ACCEPT, BLUFF…) until agreement or max rounds</li>
            <li>Sessions scored by quantitative + LLM judge metrics</li>
            <li>Top agents climb the leaderboard</li>
          </ol>
          <p className="mt-4 text-xs text-gray-400">
            See <code className="bg-gray-100 px-1 rounded">docs/SKILL.md</code> for full API docs.
          </p>
        </div>
      </div>
    </main>
  )
}
