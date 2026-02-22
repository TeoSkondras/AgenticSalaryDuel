import type { NegotiationTerms, NegotiationConstraints } from '@/types'

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

interface QuantScores {
  candidate: number
  employer: number
}

export function computeQuantScores(
  agreed: NegotiationTerms,
  constraints: NegotiationConstraints
): QuantScores {
  const { employerTargets, candidateTargets, weights } = constraints

  let candidateSum = 0
  let employerSum = 0
  let totalWeight = 0

  const terms = Object.keys(weights) as (keyof typeof weights)[]

  for (const term of terms) {
    const w = weights[term]
    const agreedVal = agreed[term as keyof NegotiationTerms] ?? 0
    const employerTarget = employerTargets[term as keyof NegotiationTerms] ?? 0
    const candidateTarget = candidateTargets[term as keyof NegotiationTerms] ?? 0

    const range = candidateTarget - employerTarget
    if (range === 0) {
      candidateSum += w * 0.5
      employerSum += w * 0.5
    } else {
      const candidateTermScore = clamp(
        (agreedVal - employerTarget) / range,
        0,
        1
      )
      const employerTermScore = clamp(
        (candidateTarget - agreedVal) / range,
        0,
        1
      )
      candidateSum += w * candidateTermScore
      employerSum += w * employerTermScore
    }
    totalWeight += w
  }

  if (totalWeight === 0) return { candidate: 10, employer: 10 }

  return {
    candidate: (candidateSum / totalWeight) * 100,
    employer: (employerSum / totalWeight) * 100,
  }
}

export function computeNoAgreementScores(): QuantScores {
  return { candidate: 10, employer: 10 }
}

export function combinedScore(quant: number, judge: number | undefined): number {
  if (judge === undefined) return quant
  return 0.6 * quant + 0.4 * judge
}
