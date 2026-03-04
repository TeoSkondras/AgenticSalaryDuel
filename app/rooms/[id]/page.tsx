import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getMultiRooms, getSessions, getMoves, getMultiScores, getChallenges, ObjectId } from '@/lib/db'
import { checkAndExpireRoom } from '@/lib/multiRoom'

export const dynamic = 'force-dynamic'

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    OPEN: 'bg-blue-100 text-blue-800',
    IN_PROGRESS: 'bg-green-100 text-green-800',
    FINALIZED: 'bg-gray-100 text-gray-600',
    EXPIRED: 'bg-red-100 text-red-700',
    ACTIVE: 'bg-green-100 text-green-800',
    ACCEPTED: 'bg-emerald-100 text-emerald-800',
    REJECTED: 'bg-red-100 text-red-700',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100'}`}>
      {status.replace('_', ' ')}
    </span>
  )
}

function formatHourKey(hourKey: string): string {
  const [year, month, day, hour] = hourKey.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(month) - 1]} ${parseInt(day)}, ${year} · ${hour}:00–${String(parseInt(hour) + 1).padStart(2,'0')}:00 EST`
}

function fmt(n?: number | null) {
  if (n == null) return '—'
  return `$${n.toLocaleString()}`
}

function fmtScore(n?: number | null) {
  if (n == null) return '—'
  return n.toFixed(1)
}

export default async function RoomDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  let roomObjId: ObjectId
  try {
    roomObjId = new ObjectId(id)
  } catch {
    notFound()
  }

  const [rooms, sessions, moves, multiScores, challenges] = await Promise.all([
    getMultiRooms(), getSessions(), getMoves(), getMultiScores(), getChallenges(),
  ])

  const room = await rooms.findOne({ _id: roomObjId })
  if (!room) notFound()

  await checkAndExpireRoom(room)
  const freshRoom = await rooms.findOne({ _id: roomObjId })
  if (!freshRoom) notFound()

  const challenge = await challenges.findOne({ _id: freshRoom.challengeId })

  // Build candidate view data
  const candidateData = await Promise.all(
    freshRoom.candidates.map(async (c) => {
      const session = await sessions.findOne({ _id: c.sessionId })
      const sessionMoves = session
        ? await moves.find({ sessionId: c.sessionId }).sort({ timestamp: 1 }).toArray()
        : []
      const multiScore = await multiScores.findOne({
        roomId: freshRoom._id!,
        agentId: c.agentId,
      })
      return { candidate: c, session, sessionMoves, multiScore }
    })
  )

  const employerScore = freshRoom.employerAgentId
    ? await multiScores.findOne({ roomId: freshRoom._id!, agentId: freshRoom.employerAgentId })
    : null

  const isExpiredOrFinalized = freshRoom.status === 'FINALIZED' || freshRoom.status === 'EXPIRED'
  const timeLeft = !isExpiredOrFinalized
    ? Math.max(0, Math.floor((new Date(freshRoom.expiresAt).getTime() - Date.now()) / 60000))
    : 0

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-10">

        {/* Nav */}
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-6">
          <Link href="/" className="hover:text-indigo-600">Home</Link>
          <span>/</span>
          <Link href="/rooms" className="hover:text-indigo-600">Battle Royale</Link>
          <span>/</span>
          <span className="text-gray-700">{formatHourKey(freshRoom.hourKey)}</span>
        </div>

        {/* Header */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-xl font-bold text-gray-900">Battle Royale Room</h1>
                <StatusBadge status={freshRoom.status} />
              </div>
              <p className="text-gray-500 text-sm">{formatHourKey(freshRoom.hourKey)}</p>
            </div>
            {!isExpiredOrFinalized && (
              <div className="text-right">
                <div className="text-2xl font-bold text-indigo-600">{timeLeft}m</div>
                <div className="text-xs text-gray-400">remaining</div>
              </div>
            )}
          </div>

          {challenge && (
            <div className="border-t pt-4 mt-4 grid md:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Position</p>
                <p className="font-medium text-gray-800">{challenge.jobInfo.title}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Company</p>
                <p className="font-medium text-gray-800">{challenge.jobInfo.company}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Salary Range</p>
                <p className="font-medium text-gray-800">
                  {fmt(challenge.constraints.employerTargets.salary)} –{' '}
                  {fmt(challenge.constraints.candidateTargets.salary)}
                </p>
              </div>
            </div>
          )}

          <div className="border-t pt-4 mt-4 flex items-center gap-6 text-sm">
            <div>
              <span className="text-gray-500">Employer: </span>
              <span className="font-medium text-gray-800">
                {freshRoom.employerHandle ?? <em className="text-gray-400">Not joined yet</em>}
              </span>
              {employerScore && (
                <span className="ml-2 text-indigo-600 font-medium">
                  Score: {fmtScore(employerScore.combinedScore)}
                </span>
              )}
            </div>
            <div>
              <span className="text-gray-500">Candidates: </span>
              <span className="font-medium text-gray-800">
                {freshRoom.candidates.length} / {freshRoom.maxCandidates}
              </span>
            </div>
            {freshRoom.selectedAnonymousLabel && (() => {
              const winnerEntry = freshRoom.candidates.find(c => c.anonymousLabel === freshRoom.selectedAnonymousLabel)
              return (
                <div>
                  <span className="text-gray-500">Winner: </span>
                  <span className="font-medium text-emerald-700">
                    {winnerEntry?.handle ?? freshRoom.selectedAnonymousLabel}
                  </span>
                </div>
              )
            })()}
          </div>
        </div>

        {/* Candidates */}
        <h2 className="font-semibold text-gray-800 mb-3">Candidates</h2>
        {candidateData.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
            No candidates have joined yet.
          </div>
        ) : (
          <div className="space-y-4">
            {candidateData.map(({ candidate, session, sessionMoves, multiScore }) => {
              const isWinner = freshRoom.selectedAnonymousLabel === candidate.anonymousLabel
              const latestCandidateOffer = sessionMoves
                .slice()
                .reverse()
                .find((m) => m.role === 'CANDIDATE' && (m.type === 'OFFER' || m.type === 'COUNTER'))
              const latestEmployerOffer = sessionMoves
                .slice()
                .reverse()
                .find((m) => m.role === 'EMPLOYER' && (m.type === 'OFFER' || m.type === 'COUNTER'))

              return (
                <div
                  key={candidate.anonymousLabel}
                  className={`bg-white rounded-xl border p-5 transition-all ${
                    isWinner
                      ? 'border-emerald-400 shadow-md ring-1 ring-emerald-100'
                      : candidate.status === 'REJECTED'
                        ? 'border-gray-200 opacity-60'
                        : 'border-gray-200 hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-800">{candidate.handle}</span>
                      <span className="text-[10px] text-gray-400 font-mono">{candidate.anonymousLabel}</span>
                      {isWinner && <span className="text-emerald-600 font-medium text-sm">✓ Selected</span>}
                      <StatusBadge status={candidate.status} />
                    </div>
                    <div className="text-sm text-gray-500">
                      {sessionMoves.length} moves · Round {session?.currentRound ?? 0}/{session?.maxRounds ?? '?'}
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-3 text-sm">
                    {latestCandidateOffer && (
                      <div className="bg-blue-50 rounded-lg p-3">
                        <p className="text-xs text-blue-600 mb-1">Candidate&apos;s Latest Ask</p>
                        <p className="font-medium text-gray-900">
                          {fmt(latestCandidateOffer.offer.salary)} base ·{' '}
                          {fmt(latestCandidateOffer.offer.bonus)} bonus ·{' '}
                          {latestCandidateOffer.offer.pto}d PTO
                        </p>
                      </div>
                    )}
                    {latestEmployerOffer && (
                      <div className="bg-purple-50 rounded-lg p-3">
                        <p className="text-xs text-purple-600 mb-1">Employer&apos;s Latest Offer</p>
                        <p className="font-medium text-gray-900">
                          {fmt(latestEmployerOffer.offer.salary)} base ·{' '}
                          {fmt(latestEmployerOffer.offer.bonus)} bonus ·{' '}
                          {latestEmployerOffer.offer.pto}d PTO
                        </p>
                      </div>
                    )}
                    {session?.agreement && (
                      <div className="bg-emerald-50 rounded-lg p-3 col-span-2">
                        <p className="text-xs text-emerald-600 mb-1">Agreement Reached</p>
                        <p className="font-medium text-gray-900">
                          {fmt(session.agreement.salary)} base ·{' '}
                          {fmt(session.agreement.bonus)} bonus ·{' '}
                          {fmt(session.agreement.equity)} equity ·{' '}
                          {session.agreement.pto}d PTO
                        </p>
                      </div>
                    )}
                  </div>

                  {multiScore && (
                    <div className="mt-3 pt-3 border-t flex gap-4 text-sm">
                      <span className="text-gray-500">Multi score:</span>
                      <span className={`font-semibold ${multiScore.combinedScore >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                        {fmtScore(multiScore.combinedScore)}
                      </span>
                      {multiScore.wasSelected && (
                        <span className="text-gray-400">(quant: {fmtScore(multiScore.quantScore)}{multiScore.judgeScore != null ? `, judge: ${fmtScore(multiScore.judgeScore)}` : ''})</span>
                      )}
                    </div>
                  )}

                  {/* Move timeline (collapsed) */}
                  {sessionMoves.length > 0 && (
                    <details className="mt-3">
                      <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
                        View {sessionMoves.length} moves
                      </summary>
                      <div className="mt-2 space-y-1">
                        {sessionMoves.map((m, i) => (
                          <div key={i} className="flex gap-2 text-xs text-gray-600">
                            <span className={`font-mono w-20 shrink-0 ${m.role === 'CANDIDATE' ? 'text-blue-600' : 'text-purple-600'}`}>
                              [{m.role === 'CANDIDATE' ? 'CAND' : 'EMPL'}·R{m.round}]
                            </span>
                            <span className="font-medium w-16 shrink-0">{m.type}</span>
                            <span className="text-gray-500">
                              {m.offer?.salary ? `$${m.offer.salary.toLocaleString()}` : '—'}
                            </span>
                            <span className="text-gray-400 truncate">{m.rationale?.slice(0, 60)}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Refresh reminder */}
        {!isExpiredOrFinalized && (
          <p className="text-center text-xs text-gray-400 mt-8">
            This page is static — refresh to see updates.
          </p>
        )}
      </div>
    </main>
  )
}
