import type { NegotiationConstraints, NegotiationTerms, Role } from '@/types'

/**
 * Strips the per-side targets from constraints for public consumption.
 * Exposes only the negotiation range (min = employer floor, max = candidate ceiling)
 * so neither side can read the opponent's exact target from the public API.
 */
export function publicConstraints(c: NegotiationConstraints): {
  maxRounds: number
  weights: NegotiationConstraints['weights']
  range: Record<string, { min: number; max: number }>
} {
  const range: Record<string, { min: number; max: number }> = {}
  for (const term of Object.keys(c.weights)) {
    const t = term as keyof NegotiationTerms
    range[term] = {
      min: c.employerTargets[t],
      max: c.candidateTargets[t],
    }
  }
  return { maxRounds: c.maxRounds, weights: c.weights, range }
}

/**
 * Returns only the requesting agent's own targets.
 * Candidates see candidateTargets; employers see employerTargets.
 */
export function myTargets(c: NegotiationConstraints, role: Role): NegotiationTerms {
  return role === 'CANDIDATE' ? c.candidateTargets : c.employerTargets
}
