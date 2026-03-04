import { getSessions, getMoves, getChallenges, getScores, getAgents, ObjectId, formatError } from '@/lib/db'
import { computeQuantScores, computeNoAgreementScores, computeAbortedScores, combinedScore } from '@/lib/scoring'
import { judgeSession } from '@/lib/judge'
import type { Session, NegotiationTerms, ScoreSummary, SessionStatus } from '@/types'

interface FinalizeOpts {
  /** True when a participant explicitly aborted — applies the abort penalty (-50). */
  aborted?: boolean
  /** Skip the expensive LLM judge call (e.g. for rejected multi-room candidates whose score is flat). */
  skipJudge?: boolean
}

export async function finalizeSession(
  session: Session,
  agreement?: NegotiationTerms,
  opts: FinalizeOpts = {}
): Promise<void> {
  if (!session._id) {
    console.warn('[finalize] called with session missing _id, skipping')
    return
  }

  const sessionId = session._id.toString()
  const reason = opts.aborted ? 'aborted' : agreement ? 'agreement' : 'no_agreement'
  console.log(`[finalize] starting sessionId=${sessionId} reason=${reason}`)

  const [sessions, moves, challenges, scores, agents] = await Promise.all([
    getSessions(),
    getMoves(),
    getChallenges(),
    getScores(),
    getAgents(),
  ])

  const challenge = await challenges.findOne({ _id: session.challengeId })
  if (!challenge) {
    console.error(`[finalize] challenge not found for challengeId=${session.challengeId}`)
    return
  }

  const sessionMoves = await moves.find({ sessionId: session._id }).toArray()
  console.log(`[finalize] found ${sessionMoves.length} moves for sessionId=${sessionId}`)

  // Compute quantitative scores
  const quant = opts.aborted
    ? computeAbortedScores()
    : agreement
      ? computeQuantScores(agreement, challenge.constraints)
      : computeNoAgreementScores()

  console.log(`[finalize] quant: candidate=${quant.candidate.toFixed(1)} employer=${quant.employer.toFixed(1)} (reason=${reason})`)

  // Agent handles
  const candidateAgent = session.candidateAgentId
    ? await agents.findOne({ _id: session.candidateAgentId })
    : null
  const employerAgent = session.employerAgentId
    ? await agents.findOne({ _id: session.employerAgentId })
    : null

  const candidateHandle = candidateAgent?.handle || session.candidateHandle || 'unknown'
  const employerHandle = employerAgent?.handle || session.employerHandle || 'unknown'

  // LLM judge — run even for no-agreement/abort if there's a transcript to evaluate
  let judgeResult = null
  if (opts.skipJudge) {
    console.log(`[finalize] skipping judge (skipJudge=true) sessionId=${sessionId}`)
  } else if (sessionMoves.length >= 2) {
    try {
      judgeResult = await judgeSession(challenge, sessionMoves, candidateHandle, employerHandle)
      if (judgeResult) {
        console.log(`[finalize] judge: candidate=${judgeResult.candidate.score} employer=${judgeResult.employer.score}`)
      }
    } catch (err) {
      console.error('[finalize] judge failed (non-fatal):', formatError(err))
    }
  } else {
    console.log('[finalize] skipping judge — fewer than 2 moves')
  }

  const judgeCandidate = judgeResult?.candidate?.score
  const judgeEmployer = judgeResult?.employer?.score

  const combinedCandidate = combinedScore(quant.candidate, judgeCandidate)
  const combinedEmployer = combinedScore(quant.employer, judgeEmployer)

  console.log(`[finalize] combined: candidate=${combinedCandidate.toFixed(1)} employer=${combinedEmployer.toFixed(1)}`)

  const scoreSummary: ScoreSummary = {
    candidateCombined: combinedCandidate,
    employerCombined: combinedEmployer,
    candidateQuant: quant.candidate,
    employerQuant: quant.employer,
    candidateJudge: judgeCandidate,
    employerJudge: judgeEmployer,
  }

  const now = new Date()
  const finalStatus: SessionStatus = opts.aborted ? 'ABORTED' : 'FINALIZED'

  try {
    await scores.replaceOne(
      { sessionId: session._id },
      {
        sessionId: session._id,
        challengeId: session.challengeId,
        candidateAgentId: session.candidateAgentId || new ObjectId(),
        employerAgentId: session.employerAgentId || new ObjectId(),
        candidateHandle,
        employerHandle,
        dayKey: session.dayKey,
        quantCandidate: quant.candidate,
        quantEmployer: quant.employer,
        judgeCandidate,
        judgeEmployer,
        combinedCandidate,
        combinedEmployer,
        judgeRaw: judgeResult || undefined,
        createdAt: now,
      },
      { upsert: true }
    )
    console.log(`[finalize] score upserted sessionId=${sessionId}`)
  } catch (err) {
    console.error(`[finalize] failed to upsert score sessionId=${sessionId}:`, formatError(err))
    throw err
  }

  try {
    await sessions.updateOne(
      { _id: session._id },
      {
        $set: {
          status: finalStatus,
          finalizedAt: now,
          scoreSummary,
          ...(agreement ? { agreement } : {}),
        },
        // Clear any stale turn timer — prevents timeout from firing during slow finalization
        $unset: { turnStartedAt: '', timeoutClaimedAt: '' },
      }
    )
    console.log(`[finalize] session set to ${finalStatus} sessionId=${sessionId}`)
  } catch (err) {
    console.error(`[finalize] failed to update session status sessionId=${sessionId}:`, formatError(err))
    throw err
  }
}
