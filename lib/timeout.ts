import { getMoves, getSessions } from '@/lib/db'
import { finalizeSession } from '@/lib/finalize'
import type { Session, NegotiationTerms } from '@/types'

/** Max ms a player has to submit a move before their opponent's last offer is auto-accepted. */
export const TURN_TIMEOUT_MS = 30_000

/**
 * Returns true if the current player's turn has exceeded TURN_TIMEOUT_MS.
 */
export function isTurnTimedOut(session: Session): boolean {
  if (session.status !== 'IN_PROGRESS' || !session.turnStartedAt) return false
  return Date.now() - new Date(session.turnStartedAt).getTime() > TURN_TIMEOUT_MS
}

/**
 * If the current player's turn has timed out, auto-accept the opponent's last offer
 * (or finalize with no-deal penalty if no offer exists yet).
 *
 * Returns true if finalization was triggered, false if no action taken.
 */
export async function handleTurnTimeout(session: Session): Promise<boolean> {
  if (!isTurnTimedOut(session)) return false

  const moves = await getMoves()

  // Find the opponent's most recent offer/counter
  const opponentRole = session.nextTurn === 'CANDIDATE' ? 'EMPLOYER' : 'CANDIDATE'
  const offerTypes = new Set(['OFFER', 'COUNTER', 'BLUFF'])

  const lastOpponentMove = await moves
    .find({ sessionId: session._id, role: opponentRole })
    .sort({ timestamp: -1 })
    .limit(10)
    .toArray()
    .then((arr) => arr.find((m) => offerTypes.has(m.type)))

  const slowRole = session.nextTurn
  const waitingRole = opponentRole

  console.log(
    `[timeout] session=${session._id} slowRole=${slowRole} waitingRole=${waitingRole} ` +
    `opponentOffer=${lastOpponentMove ? JSON.stringify(lastOpponentMove.offer) : 'none'}`
  )

  // Insert a synthetic ACCEPT move on behalf of the slow agent so the timeline makes sense
  if (lastOpponentMove?.offer) {
    const sessions = await getSessions()
    const now = new Date()

    // Record a synthetic move (timeout-accept)
    await moves.insertOne({
      sessionId: session._id!,
      agentId: slowRole === 'CANDIDATE'
        ? (session.candidateAgentId ?? session._id!)
        : (session.employerAgentId ?? session._id!),
      role: slowRole,
      type: 'ACCEPT',
      round: session.currentRound,
      offer: lastOpponentMove.offer as Partial<NegotiationTerms>,
      rationale: `[Auto-accepted after ${TURN_TIMEOUT_MS / 1000}s timeout — no response received]`,
      timestamp: now,
    })

    await sessions.updateOne(
      { _id: session._id },
      { $set: { nextTurn: waitingRole } } as any
    )

    await finalizeSession(session, lastOpponentMove.offer as NegotiationTerms)
  } else {
    // No offer to accept — finalize as no-deal
    await finalizeSession(session, undefined)
  }

  return true
}
