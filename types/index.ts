import { ObjectId } from 'mongodb'

export type Role = 'CANDIDATE' | 'EMPLOYER'

export type SessionStatus =
  | 'WAITING_FOR_OPPONENT'
  | 'IN_PROGRESS'
  | 'FINALIZED'
  | 'ABORTED'

export type MoveType =
  | 'OFFER'
  | 'COUNTER'
  | 'ACCEPT'
  | 'BLUFF'
  | 'CALL_BLUFF'
  | 'MESSAGE'

export type ChallengeStatus = 'PENDING' | 'ACTIVE' | 'LOCKED'

export interface NegotiationTerms {
  salary: number
  bonus: number
  equity: number
  pto: number
  [key: string]: number
}

export interface TermRange {
  min: number
  max: number
}

export interface NegotiationConstraints {
  maxRounds: number
  employerTargets: NegotiationTerms
  candidateTargets: NegotiationTerms
  weights: { salary: number; bonus: number; equity: number; pto: number }
}

export interface Agent {
  _id?: ObjectId
  handle: string
  tokenHash: string
  createdAt: Date
  totalSessions: number
  wins: number
}

export interface JobPosting {
  _id?: ObjectId
  source: 'greenhouse' | 'lever' | 'sample'
  externalId: string
  company: string
  title: string
  location: string
  url: string
  postedAt: Date
  rawData: Record<string, unknown>
}

export interface Challenge {
  _id?: ObjectId
  dayKey: string // YYYY-MM-DD
  index: number // 0,1,2
  jobPostingId: ObjectId
  status: ChallengeStatus
  jobInfo: {
    company: string
    title: string
    location: string
    url: string
    level: string
  }
  prompt: string
  constraints: NegotiationConstraints
  createdAt: Date
  activatedAt?: Date
  lockedAt?: Date
}

export interface ScoreSummary {
  candidateCombined: number
  employerCombined: number
  candidateQuant: number
  employerQuant: number
  candidateJudge?: number
  employerJudge?: number
}

export interface Session {
  _id?: ObjectId
  challengeId: ObjectId
  dayKey: string
  status: SessionStatus
  candidateAgentId?: ObjectId
  employerAgentId?: ObjectId
  candidateHandle?: string
  employerHandle?: string
  currentRound: number
  maxRounds: number
  nextTurn: Role
  moves: ObjectId[]
  startedAt?: Date
  /** When the current player's turn began. Used to enforce TURN_TIMEOUT_MS. */
  turnStartedAt?: Date
  /** Set atomically when a timeout is claimed. Blocks concurrent move submissions during finalization. */
  timeoutClaimedAt?: Date
  finalizedAt?: Date
  createdAt: Date
  agreement?: NegotiationTerms
  scoreSummary?: ScoreSummary
}

export interface Move {
  _id?: ObjectId
  sessionId: ObjectId
  agentId: ObjectId
  role: Role
  type: MoveType
  round: number
  offer: Partial<NegotiationTerms>
  rationale: string
  timestamp: Date
}

export interface Score {
  _id?: ObjectId
  sessionId: ObjectId
  challengeId: ObjectId
  candidateAgentId: ObjectId
  employerAgentId: ObjectId
  candidateHandle: string
  employerHandle: string
  dayKey: string
  quantCandidate: number
  quantEmployer: number
  judgeCandidate?: number
  judgeEmployer?: number
  combinedCandidate: number
  combinedEmployer: number
  judgeRaw?: JudgeResult
  createdAt: Date
}

export interface JudgeResult {
  candidate: {
    score: number
    strengths: string[]
    weaknesses: string[]
  }
  employer: {
    score: number
    strengths: string[]
    weaknesses: string[]
  }
  notes: string
}

export interface LeaderboardEntry {
  handle: string
  agentId: string
  sessionsPlayed: number
  combinedCandidate: number
  combinedEmployer: number
  totalScore: number
}

// ─── Multi-Candidate (Battle Royale) ─────────────────────────────────────────

export type MultiCandidateRoomStatus = 'OPEN' | 'IN_PROGRESS' | 'FINALIZED' | 'EXPIRED'

export interface MultiCandidateCandidate {
  agentId: ObjectId
  handle: string
  sessionId: ObjectId
  anonymousLabel: string // "Candidate-1" through "Candidate-10"
  status: 'ACTIVE' | 'ACCEPTED' | 'REJECTED'
}

/**
 * One room per hour, tied to challenge index 0 of the active day.
 * 1 employer negotiates with up to 10 candidates simultaneously.
 * Employer sees all candidates anonymized. Candidates only see their own session.
 * Employer wins by choosing the best deal; candidates win by being selected at good terms.
 */
export interface MultiCandidateRoom {
  _id?: ObjectId
  challengeId: ObjectId
  hourKey: string // "YYYY-MM-DD-HH" (UTC)
  dayKey: string  // "YYYY-MM-DD"
  status: MultiCandidateRoomStatus
  employerAgentId?: ObjectId
  employerHandle?: string
  candidates: MultiCandidateCandidate[]
  selectedCandidateAgentId?: ObjectId
  selectedAnonymousLabel?: string
  maxCandidates: number // 10
  openedAt: Date
  expiresAt: Date // openedAt + 1 hour
  finalizedAt?: Date
  createdAt: Date
}

export interface MultiCandidateScore {
  _id?: ObjectId
  roomId: ObjectId
  agentId: ObjectId
  handle: string
  role: Role
  hourKey: string
  dayKey: string
  challengeId: ObjectId
  sessionId?: ObjectId  // sub-session (undefined for employer if no selection)
  wasSelected?: boolean // for candidates: were they the chosen one?
  quantScore: number
  judgeScore?: number
  combinedScore: number
  createdAt: Date
}
