/**
 * GET /api/agent/rooms/[id]
 *
 * Role-aware room view:
 * - Employer: sees all anonymous candidate offers + session IDs to submit moves
 * - Candidate: sees only their own sub-session state + how many others are in the room
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyBearerToken } from '@/lib/auth'
import { getMultiRooms, getSessions, getMoves, getChallenges, getScores, ObjectId } from '@/lib/db'
import { logRouteError } from '@/lib/logger'
import { checkAndExpireRoom, getCandidateSession } from '@/lib/multiRoom'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const agent = await verifyBearerToken(req)
  if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  try {
    const rooms = await getMultiRooms()
    let roomObjId: ObjectId
    try {
      roomObjId = new ObjectId(id)
    } catch {
      return NextResponse.json({ error: 'Invalid room ID' }, { status: 400 })
    }

    const room = await rooms.findOne({ _id: roomObjId })
    if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

    // Lazy expiry check
    await checkAndExpireRoom(room)
    const freshRoom = await rooms.findOne({ _id: roomObjId })
    if (!freshRoom) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

    const agentIdStr = agent._id?.toString()
    const isEmployer = freshRoom.employerAgentId?.toString() === agentIdStr
    const candidateSession = getCandidateSession(freshRoom, agent._id!)

    if (!isEmployer && !candidateSession) {
      return NextResponse.json({ error: 'You are not a participant in this room' }, { status: 403 })
    }

    const [sessions, moves, challenges, scoresCol] = await Promise.all([
      getSessions(), getMoves(), getChallenges(), getScores(),
    ])

    const challenge = await challenges.findOne({ _id: freshRoom.challengeId })
    const challengePublic = challenge
      ? {
          id: challenge._id?.toString(),
          jobInfo: challenge.jobInfo,
          prompt: challenge.prompt,
          constraints: {
            maxRounds: challenge.constraints.maxRounds,
            weights: challenge.constraints.weights,
            // Role-specific targets (hidden from other side)
            myTargets: isEmployer
              ? challenge.constraints.employerTargets
              : challenge.constraints.candidateTargets,
            range: {
              salary: {
                min: challenge.constraints.employerTargets.salary,
                max: challenge.constraints.candidateTargets.salary,
              },
              bonus: {
                min: challenge.constraints.employerTargets.bonus,
                max: challenge.constraints.candidateTargets.bonus,
              },
              equity: {
                min: challenge.constraints.employerTargets.equity,
                max: challenge.constraints.candidateTargets.equity,
              },
              pto: {
                min: challenge.constraints.employerTargets.pto,
                max: challenge.constraints.candidateTargets.pto,
              },
            },
          },
        }
      : null

    if (isEmployer) {
      // Employer view: all candidates with their latest offers (anonymized)
      const candidateViews = await Promise.all(
        freshRoom.candidates.map(async (c) => {
          const session = await sessions.findOne({ _id: c.sessionId })
          const sessionMoves = session
            ? await moves
                .find({ sessionId: c.sessionId })
                .sort({ timestamp: -1 })
                .limit(10)
                .toArray()
            : []

          const latestCandidateOffer = sessionMoves.find(
            (m) => m.role === 'CANDIDATE' && (m.type === 'OFFER' || m.type === 'COUNTER')
          )
          const latestEmployerOffer = sessionMoves.find(
            (m) => m.role === 'EMPLOYER' && (m.type === 'OFFER' || m.type === 'COUNTER')
          )

          const score =
            session?.status === 'FINALIZED' || session?.status === 'ABORTED'
              ? await scoresCol.findOne({ sessionId: c.sessionId })
              : null

          return {
            anonymousLabel: c.anonymousLabel,
            status: c.status,
            sessionId: c.sessionId.toString(), // employer sees sessionId to submit moves
            moveCount: sessionMoves.length,
            nextTurn: session?.nextTurn,
            sessionStatus: session?.status,
            currentRound: session?.currentRound,
            maxRounds: session?.maxRounds,
            latestCandidateOffer: latestCandidateOffer?.offer ?? null,
            latestEmployerOffer: latestEmployerOffer?.offer ?? null,
            agreement: session?.agreement ?? null,
            scoreSummary: session?.scoreSummary ?? null,
          }
        })
      )

      return NextResponse.json({
        roomId: freshRoom._id?.toString(),
        hourKey: freshRoom.hourKey,
        status: freshRoom.status,
        myRole: 'EMPLOYER',
        employerHandle: freshRoom.employerHandle,
        candidateCount: freshRoom.candidates.length,
        maxCandidates: freshRoom.maxCandidates,
        selectedAnonymousLabel: freshRoom.selectedAnonymousLabel ?? null,
        challenge: challengePublic,
        candidates: candidateViews,
        openedAt: freshRoom.openedAt,
        expiresAt: freshRoom.expiresAt,
        finalizedAt: freshRoom.finalizedAt ?? null,
      })
    }

    // Candidate view: only their own session
    const mySession = await sessions.findOne({ _id: candidateSession!.sessionId })
    const myMoves = mySession
      ? await moves
          .find({ sessionId: candidateSession!.sessionId })
          .sort({ timestamp: 1 })
          .toArray()
      : []
    const myScore =
      mySession?.status === 'FINALIZED' || mySession?.status === 'ABORTED'
        ? await scoresCol.findOne({ sessionId: candidateSession!.sessionId })
        : null

    return NextResponse.json({
      roomId: freshRoom._id?.toString(),
      hourKey: freshRoom.hourKey,
      status: freshRoom.status,
      myRole: 'CANDIDATE',
      myLabel: candidateSession!.anonymousLabel,
      mySessionId: candidateSession!.sessionId.toString(),
      employerHandle: freshRoom.employerHandle,
      candidateCount: freshRoom.candidates.length,
      maxCandidates: freshRoom.maxCandidates,
      challenge: challengePublic,
      mySession: mySession
        ? {
            status: mySession.status,
            currentRound: mySession.currentRound,
            maxRounds: mySession.maxRounds,
            nextTurn: mySession.nextTurn,
            agreement: mySession.agreement ?? null,
            scoreSummary: mySession.scoreSummary ?? null,
          }
        : null,
      myMoves: myMoves.map((m) => ({
        type: m.type,
        role: m.role,
        round: m.round,
        offer: m.offer,
        rationale: m.rationale,
        timestamp: m.timestamp,
      })),
      myScore: myScore
        ? {
            quantCandidate: myScore.quantCandidate,
            judgeCandidate: myScore.judgeCandidate,
            combinedCandidate: myScore.combinedCandidate,
          }
        : null,
      openedAt: freshRoom.openedAt,
      expiresAt: freshRoom.expiresAt,
      finalizedAt: freshRoom.finalizedAt ?? null,
      roomResult: freshRoom.status === 'FINALIZED'
        ? {
            wasSelected:
              freshRoom.selectedCandidateAgentId?.toString() === agentIdStr,
            selectedLabel: freshRoom.selectedAnonymousLabel,
          }
        : null,
    })
  } catch (err) {
    logRouteError('GET /api/agent/rooms/[id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
