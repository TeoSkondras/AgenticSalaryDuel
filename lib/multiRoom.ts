/**
 * Multi-Candidate (Battle Royale) Room Logic
 *
 * One room per EST hour, tied to challenge index 0 of the active day.
 * - 1 employer negotiates with up to 10 candidates simultaneously
 * - Employer sees all candidates anonymized (Candidate-1 … Candidate-10)
 * - Candidates see only their own sub-session
 * - Employer ACCEPTs one candidate → room finalizes, others get rejection penalty
 * - Room expires at the next round hour if employer never accepts
 */

import {
  getChallenges,
  getSessions,
  getMultiRooms,
  getMultiScores,
  getScores,
  ObjectId,
} from '@/lib/db'
import { finalizeSession } from '@/lib/finalize'
import { computeQuantScores, combinedScore } from '@/lib/scoring'
import type {
  MultiCandidateRoom,
  MultiCandidateScore,
  Agent,
  Role,
  NegotiationTerms,
} from '@/types'

// ─── Hour key helpers (US Eastern Time) ──────────────────────────────────────

const EST_TZ = 'America/New_York'

/** Format a Date to its EST components. */
function estParts(date: Date): { year: number; month: number; day: number; hour: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: EST_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  })
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value])
  )
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24, // midnight can be "24" in some locales
  }
}

/** Returns the current hour key in US Eastern: "YYYY-MM-DD-HH" */
export function getCurrentHourKey(): string {
  return toHourKey(new Date())
}

export function toHourKey(date: Date): string {
  const { year, month, day, hour } = estParts(date)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}-${String(hour).padStart(2, '0')}`
}

/**
 * Returns the Date (absolute UTC instant) when the given EST hourKey started.
 * e.g. "2026-03-04-14" → 2:00 PM EST that day (which is 7:00 PM UTC in winter, 6:00 PM UTC in summer).
 */
export function hourKeyToOpenedAt(hourKey: string): Date {
  // Parse "YYYY-MM-DD-HH" as that hour in America/New_York
  const [year, month, day, hour] = hourKey.split('-').map(Number)
  // Build an ISO string and use a formatter round-trip to get the correct UTC offset
  // Create a rough UTC estimate, then adjust
  const rough = new Date(Date.UTC(year, month - 1, day, hour + 5)) // EST is UTC-5 (rough)
  // Refine: find the actual EST hour of our rough guess and adjust
  const roughEst = estParts(rough)
  const diffHours = roughEst.hour - hour
  const diffDays = roughEst.day - day
  const adjusted = new Date(rough.getTime() - (diffHours + diffDays * 24) * 3600_000)
  // Verify and do one more correction if DST boundary shifted us
  const verify = estParts(adjusted)
  if (verify.hour !== hour || verify.day !== day) {
    const diff2 = verify.hour - hour + (verify.day - day) * 24
    return new Date(adjusted.getTime() - diff2 * 3600_000)
  }
  return adjusted
}

/** Returns the Date when the given hourKey expires (top of next hour in EST). */
export function hourKeyToExpiresAt(hourKey: string): Date {
  const opened = hourKeyToOpenedAt(hourKey)
  return new Date(opened.getTime() + 60 * 60 * 1000)
}

/** dayKey (YYYY-MM-DD) for a given hourKey */
export function hourKeyToDayKey(hourKey: string): string {
  return hourKey.slice(0, 10)
}

// ─── Room lifecycle ───────────────────────────────────────────────────────────

/**
 * Find the room for the given hourKey, or create one if it doesn't exist.
 * Uses challenge index 0 of the active day. Throws if no active challenge found.
 */
export async function getOrCreateRoomForHour(hourKey: string): Promise<MultiCandidateRoom> {
  const rooms = await getMultiRooms()

  const existing = await rooms.findOne({ hourKey })
  if (existing) return existing

  const dayKey = hourKeyToDayKey(hourKey)
  const challenges = await getChallenges()

  // Prefer ACTIVE challenge index 0; fall back to most recent active if day hasn't started yet
  let challenge = await challenges.findOne({ dayKey, index: 0, status: 'ACTIVE' })
  if (!challenge) {
    // Fallback: most recent active challenge index 0 across all days
    challenge = await challenges.findOne(
      { index: 0, status: 'ACTIVE' },
      { sort: { dayKey: -1 } }
    )
  }
  if (!challenge) {
    throw new Error('No active challenge #1 available for multi-candidate room')
  }

  const openedAt = hourKeyToOpenedAt(hourKey)
  const expiresAt = hourKeyToExpiresAt(hourKey)
  const now = new Date()

  const roomDoc: Omit<MultiCandidateRoom, '_id'> = {
    challengeId: challenge._id!,
    hourKey,
    dayKey: challenge.dayKey,
    status: 'OPEN',
    candidates: [],
    maxCandidates: 10,
    openedAt,
    expiresAt,
    createdAt: now,
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await rooms.insertOne(roomDoc as any)
    return { ...roomDoc, _id: result.insertedId }
  } catch (err) {
    // Race condition: another request created it first — fetch and return
    const e = err as { code?: number }
    if (e.code === 11000) {
      const raceWinner = await rooms.findOne({ hourKey })
      if (raceWinner) return raceWinner
    }
    throw err
  }
}

/** Register an agent as the employer for the room. */
export async function joinRoomAsEmployer(
  roomId: ObjectId,
  agent: Agent
): Promise<void> {
  const rooms = await getMultiRooms()
  const room = await rooms.findOne({ _id: roomId })
  if (!room) throw new Error('Room not found')
  if (room.status === 'FINALIZED' || room.status === 'EXPIRED') {
    throw new Error('Room is closed')
  }
  if (room.employerAgentId) {
    if (room.employerAgentId.toString() === agent._id?.toString()) {
      return // idempotent — already joined
    }
    throw new Error('Room already has an employer')
  }

  await rooms.updateOne(
    { _id: roomId, employerAgentId: { $exists: false } }, // atomic guard
    { $set: { employerAgentId: agent._id, employerHandle: agent.handle } }
  )
}

/**
 * Register a candidate in the room and create their private sub-session.
 * Returns the new sessionId and their anonymous label.
 */
export async function joinRoomAsCandidate(
  roomId: ObjectId,
  agent: Agent
): Promise<{ sessionId: ObjectId; anonymousLabel: string }> {
  const rooms = await getMultiRooms()
  const room = await rooms.findOne({ _id: roomId })
  if (!room) throw new Error('Room not found')
  if (room.status === 'FINALIZED' || room.status === 'EXPIRED') {
    throw new Error('Room is closed')
  }
  if (!room.employerAgentId) {
    throw new Error('Room has no employer yet — an employer must join first')
  }
  if (room.candidates.length >= room.maxCandidates) {
    throw new Error('Room is full (max 10 candidates)')
  }
  if (room.candidates.some((c) => c.agentId.toString() === agent._id?.toString())) {
    throw new Error('You have already joined this room')
  }
  if (room.employerAgentId.toString() === agent._id?.toString()) {
    throw new Error('You are already the employer in this room')
  }

  const challenges = await getChallenges()
  const challenge = await challenges.findOne({ _id: room.challengeId })
  if (!challenge) throw new Error('Challenge not found for this room')

  const sessions = await getSessions()
  const now = new Date()

  // Create sub-session. Candidate goes first (makes their opening ask).
  const sessionDoc = {
    challengeId: room.challengeId,
    dayKey: room.dayKey,
    status: 'IN_PROGRESS' as const,
    candidateAgentId: agent._id!,
    candidateHandle: agent.handle,
    employerAgentId: room.employerAgentId,
    employerHandle: room.employerHandle,
    currentRound: 0,
    maxRounds: challenge.constraints.maxRounds,
    nextTurn: 'CANDIDATE' as Role,
    moves: [],
    startedAt: now,
    turnStartedAt: now,
    createdAt: now,
  }

  const sessionResult = await sessions.insertOne(sessionDoc)
  const sessionId = sessionResult.insertedId
  const anonymousLabel = `Candidate-${room.candidates.length + 1}`

  await rooms.updateOne(
    { _id: roomId },
    {
      $set: { status: 'IN_PROGRESS' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $push: {
        candidates: {
          agentId: agent._id!,
          handle: agent.handle,
          sessionId,
          anonymousLabel,
          status: 'ACTIVE',
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    }
  )

  return { sessionId, anonymousLabel }
}

// ─── Room finalization ────────────────────────────────────────────────────────

/**
 * Finalize the room.
 * - selectedSessionId: the sub-session the employer accepted (undefined if room expired)
 * - Finalizes all sub-sessions, computes MultiCandidateScores
 */
export async function finalizeRoom(
  roomId: ObjectId,
  selectedSessionId?: ObjectId
): Promise<void> {
  const rooms = await getMultiRooms()
  const room = await rooms.findOne({ _id: roomId })
  if (!room) return
  if (room.status === 'FINALIZED' || room.status === 'EXPIRED') return

  const sessions = await getSessions()
  const multiScores = await getMultiScores()
  const scoresCol = await getScores()
  const now = new Date()

  // Mark room as finalizing (prevent race conditions)
  const lockResult = await rooms.updateOne(
    { _id: roomId, status: { $in: ['OPEN', 'IN_PROGRESS'] } },
    { $set: { status: selectedSessionId ? 'FINALIZED' : 'EXPIRED', finalizedAt: now } }
  )
  if (lockResult.modifiedCount === 0) return // Another call won the race

  // Finalize each candidate's sub-session
  for (const candidate of room.candidates) {
    const session = await sessions.findOne({ _id: candidate.sessionId })
    if (!session) continue

    const isSelected =
      selectedSessionId != null &&
      candidate.sessionId.toString() === selectedSessionId.toString()

    if (session.status === 'IN_PROGRESS' || session.status === 'WAITING_FOR_OPPONENT') {
      if (isSelected) {
        // Should already be FINALIZED by the ACCEPT move, but finalize anyway as guard
        await finalizeSession(session, undefined)
      } else {
        // Rejected — finalize with no-agreement so there's a standard Score document
        await finalizeSession(session, undefined)
      }
    }

    // Compute multi-specific score
    let quantScore: number
    let judgeScore: number | undefined
    let combinedScoreVal: number

    if (isSelected) {
      // Use standard session score for selected candidate
      const sessionScore = await scoresCol.findOne({ sessionId: candidate.sessionId })
      if (sessionScore) {
        quantScore = sessionScore.quantCandidate
        judgeScore = sessionScore.judgeCandidate
        combinedScoreVal = sessionScore.combinedCandidate
      } else {
        quantScore = 0
        combinedScoreVal = 0
      }
    } else {
      // Rejected candidates: flat -20 (less harsh than standard no-agreement -40)
      quantScore = -20
      combinedScoreVal = -20
    }

    const multiScore: Omit<MultiCandidateScore, '_id'> = {
      roomId,
      agentId: candidate.agentId,
      handle: candidate.handle,
      role: 'CANDIDATE',
      hourKey: room.hourKey,
      dayKey: room.dayKey,
      challengeId: room.challengeId,
      sessionId: candidate.sessionId,
      wasSelected: isSelected,
      quantScore,
      judgeScore,
      combinedScore: combinedScoreVal,
      createdAt: now,
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await multiScores.replaceOne({ roomId, agentId: candidate.agentId }, multiScore as any, {
      upsert: true,
    })
  }

  // Employer multi-score
  if (room.employerAgentId) {
    let employerQuantScore: number
    let employerCombinedScore: number
    let employerSessionId: ObjectId | undefined

    if (selectedSessionId) {
      const sessionScore = await scoresCol.findOne({ sessionId: selectedSessionId })
      if (sessionScore) {
        employerQuantScore = sessionScore.quantEmployer
        // Check if employer picked the best available deal
        const bestEmployerQuant = await getBestEmployerQuantForRoom(room, scoresCol)
        // Bonus if they chose within 5 points of the best; small penalty if they missed it
        const selectionBonus =
          bestEmployerQuant > 0 && sessionScore.quantEmployer < bestEmployerQuant - 10
            ? -10 // They could have gotten a better deal
            : sessionScore.quantEmployer >= bestEmployerQuant - 5
              ? 5 // Near-optimal pick
              : 0
        employerQuantScore = Math.min(100, sessionScore.quantEmployer + selectionBonus)
        const employerJudge = sessionScore.judgeEmployer
        employerCombinedScore = employerJudge !== undefined
          ? 0.6 * employerQuantScore + 0.4 * employerJudge
          : employerQuantScore
      } else {
        employerQuantScore = -30
        employerCombinedScore = -30
      }
      employerSessionId = selectedSessionId
    } else {
      // No candidate selected — employer penalty for not closing
      employerQuantScore = -30
      employerCombinedScore = -30
    }

    const employerMultiScore: Omit<MultiCandidateScore, '_id'> = {
      roomId,
      agentId: room.employerAgentId,
      handle: room.employerHandle || 'unknown',
      role: 'EMPLOYER',
      hourKey: room.hourKey,
      dayKey: room.dayKey,
      challengeId: room.challengeId,
      sessionId: employerSessionId,
      quantScore: employerQuantScore,
      combinedScore: employerCombinedScore,
      createdAt: now,
    }

    await multiScores.replaceOne(
      { roomId, agentId: room.employerAgentId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      employerMultiScore as any,
      { upsert: true }
    )
  }

  // Update candidate statuses in room
  if (selectedSessionId) {
    const updatedCandidates = room.candidates.map((c) => ({
      ...c,
      status: (c.sessionId.toString() === selectedSessionId.toString()
        ? 'ACCEPTED'
        : 'REJECTED') as 'ACCEPTED' | 'REJECTED' | 'ACTIVE',
    }))
    const selectedCandidate = room.candidates.find(
      (c) => c.sessionId.toString() === selectedSessionId.toString()
    )
    await rooms.updateOne(
      { _id: roomId },
      {
        $set: {
          candidates: updatedCandidates,
          ...(selectedCandidate
            ? {
                selectedCandidateAgentId: selectedCandidate.agentId,
                selectedAnonymousLabel: selectedCandidate.anonymousLabel,
              }
            : {}),
        },
      }
    )
  } else {
    // Expire: mark all active candidates as REJECTED
    const updatedCandidates = room.candidates.map((c) => ({
      ...c,
      status: (c.status === 'ACTIVE' ? 'REJECTED' : c.status) as
        | 'ACTIVE'
        | 'ACCEPTED'
        | 'REJECTED',
    }))
    await rooms.updateOne({ _id: roomId }, { $set: { candidates: updatedCandidates } })
  }
}

/** Returns the best employer quant score across all completed sub-sessions in the room. */
async function getBestEmployerQuantForRoom(
  room: MultiCandidateRoom,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scoresCol: any
): Promise<number> {
  let best = 0
  for (const candidate of room.candidates) {
    const s = await scoresCol.findOne({ sessionId: candidate.sessionId })
    if (s && s.quantEmployer > best) best = s.quantEmployer
  }
  return best
}

/** Check if a room has expired and trigger finalization if so. Returns true if expired. */
export async function checkAndExpireRoom(room: MultiCandidateRoom): Promise<boolean> {
  if (room.status === 'FINALIZED' || room.status === 'EXPIRED') return false
  if (new Date() < room.expiresAt) return false
  await finalizeRoom(room._id!, undefined)
  return true
}

/** Get candidate's sub-session ID from a room, or null if not a participant. */
export function getCandidateSession(
  room: MultiCandidateRoom,
  agentId: ObjectId
): { sessionId: ObjectId; anonymousLabel: string } | null {
  const c = room.candidates.find((c) => c.agentId.toString() === agentId.toString())
  if (!c) return null
  return { sessionId: c.sessionId, anonymousLabel: c.anonymousLabel }
}

/** Get the candidate entry by anonymous label. */
export function getCandidateByLabel(
  room: MultiCandidateRoom,
  label: string
): MultiCandidateRoom['candidates'][0] | null {
  return room.candidates.find((c) => c.anonymousLabel === label) ?? null
}

// ─── Shared session-move logic (used by room moves endpoint) ─────────────────

export interface RoomMoveResult {
  moveId: string
  type: string
  nextTurn?: Role
  round: number
  status?: 'FINALIZED'
  pressureAlert?: { roundsLeft: number; message: string }
  roomFinalized?: boolean
  outOfRangeWarning?: string[]
}

/**
 * Submit a move to a sub-session on behalf of an agent in a room.
 * When the employer submits ACCEPT, this also triggers room finalization.
 */
export async function submitRoomMove(
  room: MultiCandidateRoom,
  sessionId: ObjectId,
  agentId: ObjectId,
  callerRole: Role,
  move: { type: string; offer: Partial<NegotiationTerms>; rationale: string }
): Promise<RoomMoveResult> {
  const sessions = await getSessions()
  const { getMoves, getChallenges } = await import('@/lib/db')
  const moves = await getMoves()
  const challenges = await getChallenges()

  const session = await sessions.findOne({ _id: sessionId })
  if (!session) throw new Error('Session not found')
  if (session.status !== 'IN_PROGRESS') throw new Error('Session is not in progress')
  if (session.timeoutClaimedAt) throw new Error('Turn timed out — session is being finalized')
  if (callerRole !== session.nextTurn) {
    throw new Error(`Not your turn. Waiting for ${session.nextTurn}`)
  }

  const challenge = await challenges.findOne({ _id: session.challengeId })
  if (!challenge) throw new Error('Challenge not found')

  // Out-of-range warning
  const outOfRange: string[] = []
  for (const [term, val] of Object.entries(move.offer)) {
    if (val === undefined) continue
    const empTarget = challenge.constraints.employerTargets[term as keyof NegotiationTerms]
    const candTarget = challenge.constraints.candidateTargets[term as keyof NegotiationTerms]
    if (val < empTarget * 0.7 || val > candTarget * 1.5) outOfRange.push(term)
  }

  const newRound =
    session.nextTurn === 'EMPLOYER' ? session.currentRound + 1 : session.currentRound

  const now = new Date()
  const type = move.type as import('@/types').MoveType
  const moveResult = await moves.insertOne({
    sessionId,
    agentId,
    role: callerRole,
    type,
    round: newRound,
    offer: move.offer as Partial<NegotiationTerms>,
    rationale: move.rationale,
    timestamp: now,
  })

  const nextTurn: Role = callerRole === 'CANDIDATE' ? 'EMPLOYER' : 'CANDIDATE'
  const willFinalize = type === 'ACCEPT' || newRound >= session.maxRounds

  await sessions.updateOne(
    { _id: sessionId },
    {
      $set: {
        nextTurn,
        currentRound: newRound,
        ...(willFinalize ? {} : { turnStartedAt: now }),
      },
      ...(willFinalize ? { $unset: { turnStartedAt: '' } } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $push: { moves: moveResult.insertedId } as any,
    }
  )

  const updatedSession = await sessions.findOne({ _id: sessionId })

  if (type === 'ACCEPT') {
    const allMoves = await moves.find({ sessionId }).sort({ timestamp: -1 }).toArray()
    const opponentRole: Role = callerRole === 'CANDIDATE' ? 'EMPLOYER' : 'CANDIDATE'
    const lastOpponentOffer = allMoves.find(
      (m) => m.role === opponentRole && (m.type === 'OFFER' || m.type === 'COUNTER')
    )
    const agreement = (lastOpponentOffer?.offer as NegotiationTerms) ?? {
      salary: 0, bonus: 0, equity: 0, pto: 0,
    }

    await finalizeSession(updatedSession!, agreement)

    let roomFinalized = false
    // Only the employer can "win" the room by accepting a candidate
    if (callerRole === 'EMPLOYER') {
      await finalizeRoom(room._id!, sessionId)
      roomFinalized = true
    }

    return {
      moveId: moveResult.insertedId.toString(),
      type,
      round: newRound,
      status: 'FINALIZED',
      roomFinalized,
      outOfRangeWarning: outOfRange.length > 0 ? outOfRange : undefined,
    }
  }

  if (updatedSession && updatedSession.currentRound >= updatedSession.maxRounds) {
    await finalizeSession(updatedSession, undefined)
    // Mark this candidate as REJECTED in the room and create their multi-score
    const candidateEntry = room.candidates.find(
      (c) => c.sessionId.toString() === sessionId.toString()
    )
    if (candidateEntry && candidateEntry.status === 'ACTIVE') {
      const roomsCol = await getMultiRooms()
      const multiScoresCol = await getMultiScores()
      await roomsCol.updateOne(
        { _id: room._id, 'candidates.sessionId': sessionId },
        { $set: { 'candidates.$.status': 'REJECTED' } }
      )
      await multiScoresCol.replaceOne(
        { roomId: room._id!, agentId: candidateEntry.agentId },
        {
          roomId: room._id!,
          agentId: candidateEntry.agentId,
          handle: candidateEntry.handle,
          role: 'CANDIDATE' as Role,
          hourKey: room.hourKey,
          dayKey: room.dayKey,
          challengeId: room.challengeId,
          sessionId: candidateEntry.sessionId,
          wasSelected: false,
          quantScore: -20,
          combinedScore: -20,
          createdAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        { upsert: true }
      )
    }
    return {
      moveId: moveResult.insertedId.toString(),
      type,
      round: newRound,
      status: 'FINALIZED',
      outOfRangeWarning: outOfRange.length > 0 ? outOfRange : undefined,
    }
  }

  const roundsLeft = (updatedSession?.maxRounds ?? session.maxRounds) - newRound
  const pressureAlert =
    roundsLeft <= 3
      ? {
          roundsLeft,
          message: `Only ${roundsLeft} round${roundsLeft === 1 ? '' : 's'} left. Consider accepting.`,
        }
      : undefined

  return {
    moveId: moveResult.insertedId.toString(),
    type,
    nextTurn,
    round: newRound,
    pressureAlert,
    outOfRangeWarning: outOfRange.length > 0 ? outOfRange : undefined,
  }
}
