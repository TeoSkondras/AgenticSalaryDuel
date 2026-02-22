'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

interface Move {
  id: string
  role: 'CANDIDATE' | 'EMPLOYER'
  type: string
  round: number
  offer: Record<string, number>
  rationale: string
  timestamp: string
}

interface SessionDetail {
  id: string
  challengeId: string
  status: string
  candidateHandle?: string
  employerHandle?: string
  currentRound: number
  maxRounds: number
  nextTurn: string
  createdAt: string
  startedAt?: string
  finalizedAt?: string
  agreement?: Record<string, number>
  scoreSummary?: {
    candidateCombined: number
    employerCombined: number
    candidateQuant: number
    employerQuant: number
    candidateJudge?: number
    employerJudge?: number
  }
}

interface ScoreDetail {
  quantCandidate: number
  quantEmployer: number
  judgeCandidate?: number
  judgeEmployer?: number
  combinedCandidate: number
  combinedEmployer: number
  judgeRaw?: {
    candidate: { score: number; strengths: string[]; weaknesses: string[] }
    employer: { score: number; strengths: string[]; weaknesses: string[] }
    notes: string
  }
}

interface SessionData {
  session: SessionDetail
  moves: Move[]
  score: ScoreDetail | null
  challenge: {
    jobInfo: { company: string; title: string }
  } | null
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    IN_PROGRESS: 'bg-blue-100 text-blue-800',
    WAITING_FOR_OPPONENT: 'bg-orange-100 text-orange-800',
    FINALIZED: 'bg-purple-100 text-purple-800',
    ABORTED: 'bg-red-100 text-red-600',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-600'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

function MoveBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    OFFER: 'bg-blue-50 text-blue-700 border-blue-200',
    COUNTER: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    ACCEPT: 'bg-green-50 text-green-700 border-green-200',
    BLUFF: 'bg-pink-50 text-pink-700 border-pink-200',
    CALL_BLUFF: 'bg-red-50 text-red-700 border-red-200',
    MESSAGE: 'bg-gray-50 text-gray-600 border-gray-200',
  }
  return (
    <span className={`px-2 py-0.5 rounded border text-xs font-medium ${colors[type] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
      {type}
    </span>
  )
}

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [data, setData] = useState<SessionData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    params.then(({ id }) => setSessionId(id))
  }, [params])

  const fetchData = useCallback(async () => {
    if (!sessionId) return
    try {
      const res = await fetch(`/api/public/sessions/${sessionId}`)
      if (!res.ok) {
        setError('Session not found')
        return
      }
      const json = await res.json()
      setData(json)
    } catch {
      setError('Failed to load session')
    }
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    fetchData()
    // Poll every 3s if not finalized/aborted
    const interval = setInterval(() => {
      if (data?.session?.status === 'FINALIZED' || data?.session?.status === 'ABORTED') {
        clearInterval(interval)
        return
      }
      fetchData()
    }, 3000)
    return () => clearInterval(interval)
  }, [sessionId, data?.session?.status, fetchData])

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 text-lg">{error}</p>
          <Link href="/" className="text-indigo-600 text-sm mt-4 block">← Home</Link>
        </div>
      </main>
    )
  }

  if (!data) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400">Loading…</p>
      </main>
    )
  }

  const { session, moves, score } = data

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="mb-6 flex items-center justify-between">
          <Link
            href={`/challenge/${session.challengeId}`}
            className="text-sm text-indigo-600 hover:underline"
          >
            ← Back to challenge
          </Link>
          <StatusBadge status={session.status} />
        </div>

        {/* Header */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          {data.challenge && (
            <h1 className="text-lg font-bold text-gray-900 mb-2">
              {data.challenge.jobInfo.title} @ {data.challenge.jobInfo.company}
            </h1>
          )}
          <div className="flex gap-6 text-sm text-gray-600">
            <span>
              <span className="font-medium text-green-700">Candidate:</span>{' '}
              {session.candidateHandle || '—'}
            </span>
            <span>
              <span className="font-medium text-blue-700">Employer:</span>{' '}
              {session.employerHandle || '—'}
            </span>
          </div>
          <div className="mt-2 text-xs text-gray-400">
            Round {session.currentRound}/{session.maxRounds}
            {session.status === 'IN_PROGRESS' && (
              <span className="ml-3 text-indigo-600">Next turn: {session.nextTurn}</span>
            )}
          </div>
        </div>

        {/* Agreement + Scores */}
        {session.status === 'FINALIZED' && (
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-5 mb-6">
            <h2 className="font-semibold text-purple-900 mb-3">Final Agreement</h2>

            {session.agreement ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
                {Object.entries(session.agreement).map(([k, v]) => (
                  <div key={k} className="bg-white rounded p-2 text-center">
                    <p className="text-xs text-gray-500 capitalize">{k}</p>
                    <p className="font-semibold text-gray-900">
                      {k === 'pto' ? `${v} days` : `$${Number(v).toLocaleString()}`}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-600 mb-4">No agreement reached.</p>
            )}

            {score && (
              <div className="grid grid-cols-2 gap-4 text-sm">
                {(['candidate', 'employer'] as const).map((role) => {
                  const combined = role === 'candidate' ? score.combinedCandidate : score.combinedEmployer
                  const quant = role === 'candidate' ? score.quantCandidate : score.quantEmployer
                  const judge = role === 'candidate' ? score.judgeCandidate : score.judgeEmployer
                  const handle = role === 'candidate' ? session.candidateHandle : session.employerHandle
                  return (
                    <div key={role} className="bg-white rounded-lg p-3">
                      <p className="font-medium text-gray-700 capitalize mb-1">{role} ({handle})</p>
                      <p className="text-2xl font-bold text-indigo-700">{combined.toFixed(1)}</p>
                      <p className="text-xs text-gray-500 mt-1">Quant: {quant.toFixed(1)} | Judge: {judge != null ? judge.toFixed(1) : 'N/A'}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Move Timeline */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">
            Move Timeline ({moves.length} moves)
          </h2>

          {moves.length === 0 ? (
            <p className="text-gray-400 text-sm">No moves yet.</p>
          ) : (
            <div className="space-y-3">
              {moves.map((move) => (
                <div
                  key={move.id}
                  className={`p-4 rounded-lg border ${move.role === 'CANDIDATE' ? 'border-green-100 bg-green-50/50' : 'border-blue-100 bg-blue-50/50'}`}
                >
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold ${move.role === 'CANDIDATE' ? 'text-green-700' : 'text-blue-700'}`}>
                        {move.role}
                      </span>
                      <span className="text-xs text-gray-400">Round {move.round}</span>
                      <MoveBadge type={move.type} />
                    </div>
                    <span className="text-xs text-gray-400">
                      {new Date(move.timestamp).toLocaleTimeString()}
                    </span>
                  </div>

                  {Object.keys(move.offer).length > 0 && (
                    <div className="flex gap-4 text-sm text-gray-700 mb-2">
                      {Object.entries(move.offer).map(([k, v]) => (
                        <span key={k}>
                          <span className="text-xs text-gray-500 capitalize">{k}:</span>{' '}
                          {k === 'pto' ? `${v}d` : `$${Number(v).toLocaleString()}`}
                        </span>
                      ))}
                    </div>
                  )}

                  {move.rationale && (
                    <p className="text-xs text-gray-600 italic">{move.rationale}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
