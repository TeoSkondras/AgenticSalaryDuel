import OpenAI from 'openai'
import type { Move, Challenge, JudgeResult } from '@/types'
import { formatError } from '@/lib/db'

let openaiClient: OpenAI | null = null

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return openaiClient
}

const JUDGE_SYSTEM_PROMPT = `You are an expert negotiation judge evaluating AI agents in a salary negotiation exercise.
Score each party on 5 dimensions (0-100 each), then compute a weighted average:
- Clarity (20%): Clear, unambiguous communication of positions
- Justification (25%): Quality of reasoning provided for each offer
- Strategy (25%): Effective use of negotiation tactics, timing of concessions
- Concessions (15%): Appropriateness and pacing of concessions made
- Professionalism (15%): Constructive, respectful tone throughout

Return a JSON object with this exact structure:
{
  "candidate": {
    "score": <number 0-100>,
    "strengths": [<string>, ...],
    "weaknesses": [<string>, ...]
  },
  "employer": {
    "score": <number 0-100>,
    "strengths": [<string>, ...],
    "weaknesses": [<string>, ...]
  },
  "notes": "<overall assessment string>"
}`

export async function judgeSession(
  challenge: Challenge,
  moves: Move[],
  candidateHandle: string,
  employerHandle: string
): Promise<JudgeResult | null> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('No OPENAI_API_KEY set, skipping judge')
    return null
  }

  const openai = getOpenAI()
  const model = process.env.GPT_MODEL || 'gpt-4o'

  const transcript = moves
    .map((m) => {
      const role = m.role === 'CANDIDATE' ? candidateHandle : employerHandle
      const offerStr = Object.entries(m.offer)
        .map(([k, v]) => `${k}=$${v?.toLocaleString()}`)
        .join(', ')
      return `[Round ${m.round}] ${role} (${m.role}) - ${m.type}: ${offerStr} | Rationale: ${m.rationale}`
    })
    .join('\n')

  const userMessage = `
Job: ${challenge.jobInfo.title} at ${challenge.jobInfo.company} (${challenge.jobInfo.level})
Candidate agent: ${candidateHandle}
Employer agent: ${employerHandle}

Negotiation transcript:
${transcript}

Please evaluate both agents' negotiation performance.`

  try {
    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: JUDGE_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      response_format: { type: 'json_object' },
    })

    const content = response.choices[0]?.message?.content
    if (!content) return null

    const parsed = JSON.parse(content) as JudgeResult
    return parsed
  } catch (err) {
    console.error(`[judge] failed with model=${model}:`, JSON.stringify(formatError(err)))
    return null
  }
}
