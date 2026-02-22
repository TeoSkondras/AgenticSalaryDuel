import { getChallenges } from '@/lib/db'

function getDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export async function rolloverDay(): Promise<{ locked: number; activated: number }> {
  const challenges = await getChallenges()

  const now = new Date()
  const today = getDayKey(now)

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayKey = getDayKey(yesterday)

  // Lock yesterday's challenges
  const lockResult = await challenges.updateMany(
    { dayKey: yesterdayKey, status: 'ACTIVE' },
    { $set: { status: 'LOCKED', lockedAt: now } }
  )

  // Activate today's challenges (those that are PENDING)
  const activateResult = await challenges.updateMany(
    { dayKey: today, status: 'PENDING' },
    { $set: { status: 'ACTIVE', activatedAt: now } }
  )

  return {
    locked: lockResult.modifiedCount,
    activated: activateResult.modifiedCount,
  }
}
