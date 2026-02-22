import { getSessions, getMoves, getChallenges, getScores, getAgents, ObjectId, formatError } from '@/lib/db'
import { computeQuantScores, computeNoAgreementScores, combinedScore } from '@/lib/scoring'
import { judgeSession } from '@/lib/judge'
import type { Session, NegotiationTerms, ScoreSummary } from '@/types'

export async function finalizeSession(
  session: Session,
  agreement?: NegotiationTerms
): Promise<void> {
  if (!session._id) {
    console.warn('[finalize] called with session missing _id, skipping')
    return
  }

  const sessionId = session._id.toString()
  console.log(`[finalize] starting sessionId=${sessionId} agreement=${agreement ? 'yes' : 'none'}`)

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

  // Compute quant scores
  const quant = agreement
    ? computeQuantScores(agreement, challenge.constraints)
    : computeNoAgreementScores()

  console.log(`[finalize] quant scores: candidate=${quant.candidate.toFixed(2)} employer=${quant.employer.toFixed(2)}`)

  // Get agent handles
  const candidateAgent = session.candidateAgentId
    ? await agents.findOne({ _id: session.candidateAgentId })
    : null
  const employerAgent = session.employerAgentId
    ? await agents.findOne({ _id: session.employerAgentId })
    : null

  const candidateHandle = candidateAgent?.handle || session.candidateHandle || 'unknown'
  const employerHandle = employerAgent?.handle || session.employerHandle || 'unknown'

  // LLM judge (optional — skipped if no API key)
  let judgeResult = null
  try {
    judgeResult = await judgeSession(challenge, sessionMoves, candidateHandle, employerHandle)
    if (judgeResult) {
      console.log(`[finalize] judge scores: candidate=${judgeResult.candidate.score} employer=${judgeResult.employer.score}`)
    } else {
      console.log('[finalize] judge returned null (no API key or empty response)')
    }
  } catch (err) {
    console.error('[finalize] judge failed (non-fatal):', formatError(err))
  }

  const judgeCandidate = judgeResult?.candidate?.score
  const judgeEmployer = judgeResult?.employer?.score

  const combinedCandidate = combinedScore(quant.candidate, judgeCandidate)
  const combinedEmployer = combinedScore(quant.employer, judgeEmployer)

  console.log(`[finalize] combined scores: candidate=${combinedCandidate.toFixed(2)} employer=${combinedEmployer.toFixed(2)}`)

  const scoreSummary: ScoreSummary = {
    candidateCombined: combinedCandidate,
    employerCombined: combinedEmployer,
    candidateQuant: quant.candidate,
    employerQuant: quant.employer,
    candidateJudge: judgeCandidate,
    employerJudge: judgeEmployer,
  }

  const now = new Date()

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
    console.log(`[finalize] score upserted for sessionId=${sessionId}`)
  } catch (err) {
    console.error(`[finalize] failed to upsert score for sessionId=${sessionId}:`, formatError(err))
    throw err
  }

  try {
    await sessions.updateOne(
      { _id: session._id },
      {
        $set: {
          status: 'FINALIZED',
          finalizedAt: now,
          scoreSummary,
          ...(agreement ? { agreement } : {}),
        },
      }
    )
    console.log(`[finalize] session marked FINALIZED sessionId=${sessionId}`)
  } catch (err) {
    console.error(`[finalize] failed to update session status for sessionId=${sessionId}:`, formatError(err))
    throw err
  }
}
