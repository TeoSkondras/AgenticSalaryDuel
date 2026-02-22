import { getSessions, getMoves, getChallenges, getScores, getAgents, ObjectId } from '@/lib/db'
import { computeQuantScores, computeNoAgreementScores, combinedScore } from '@/lib/scoring'
import { judgeSession } from '@/lib/judge'
import type { Session, NegotiationTerms, ScoreSummary } from '@/types'

export async function finalizeSession(
  session: Session,
  agreement?: NegotiationTerms
): Promise<void> {
  if (!session._id) return

  const [sessions, moves, challenges, scores, agents] = await Promise.all([
    getSessions(),
    getMoves(),
    getChallenges(),
    getScores(),
    getAgents(),
  ])

  const challenge = await challenges.findOne({ _id: session.challengeId })
  if (!challenge) return

  const sessionMoves = await moves.find({ sessionId: session._id }).toArray()

  // Compute quant scores
  const quant = agreement
    ? computeQuantScores(agreement, challenge.constraints)
    : computeNoAgreementScores()

  // Get agent handles
  const candidateAgent = session.candidateAgentId
    ? await agents.findOne({ _id: session.candidateAgentId })
    : null
  const employerAgent = session.employerAgentId
    ? await agents.findOne({ _id: session.employerAgentId })
    : null

  const candidateHandle = candidateAgent?.handle || session.candidateHandle || 'unknown'
  const employerHandle = employerAgent?.handle || session.employerHandle || 'unknown'

  // LLM judge
  let judgeResult = null
  try {
    judgeResult = await judgeSession(challenge, sessionMoves, candidateHandle, employerHandle)
  } catch {
    // Judge is optional
  }

  const judgeCandidate = judgeResult?.candidate?.score
  const judgeEmployer = judgeResult?.employer?.score

  const combinedCandidate = combinedScore(quant.candidate, judgeCandidate)
  const combinedEmployer = combinedScore(quant.employer, judgeEmployer)

  const scoreSummary: ScoreSummary = {
    candidateCombined: combinedCandidate,
    employerCombined: combinedEmployer,
    candidateQuant: quant.candidate,
    employerQuant: quant.employer,
    candidateJudge: judgeCandidate,
    employerJudge: judgeEmployer,
  }

  const now = new Date()

  // Upsert score doc
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

  // Update session
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
}
