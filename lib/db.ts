import { MongoClient, Db, Collection, ObjectId } from 'mongodb'
import type { Agent, Challenge, Session, Move, Score, JobPosting } from '@/types'

const dbName = process.env.MONGODB_DB || 'agenticsalaryduel'

// Connection caching for Next.js HMR
let client: MongoClient
let db: Db

declare global {
  // eslint-disable-next-line no-var
  var _mongoClient: MongoClient | undefined
  // eslint-disable-next-line no-var
  var _mongoDb: Db | undefined
}

async function connect(): Promise<{ client: MongoClient; db: Db }> {
  const uri = process.env.MONGODB_URI
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is not set')
  }

  if (process.env.NODE_ENV === 'development') {
    if (!global._mongoClient) {
      global._mongoClient = new MongoClient(uri)
      await global._mongoClient.connect()
      global._mongoDb = global._mongoClient.db(dbName)
      await ensureIndexes(global._mongoDb)
    }
    return { client: global._mongoClient!, db: global._mongoDb! }
  }

  if (!client) {
    client = new MongoClient(uri)
    await client.connect()
    db = client.db(dbName)
    await ensureIndexes(db)
  }
  return { client, db }
}

async function ensureIndexes(database: Db): Promise<void> {
  // Drop stale indexes from old schema (fields were renamed: name→handle, apiKeyHash→tokenHash)
  await database.collection('agents').dropIndex('apiKeyHash_1').catch(() => {})
  await database.collection('agents').dropIndex('name_1').catch(() => {})

  await database
    .collection('agents')
    .createIndex({ handle: 1 }, { unique: true })
    .catch(() => {})

  await database
    .collection('agents')
    .createIndex({ tokenHash: 1 }, { unique: true })
    .catch(() => {})

  await database
    .collection('challenges')
    .createIndex({ dayKey: 1, index: 1 }, { unique: true })
    .catch(() => {})

  await database
    .collection('challenges')
    .createIndex({ status: 1 })
    .catch(() => {})

  await database
    .collection('sessions')
    .createIndex({ challengeId: 1 })
    .catch(() => {})

  await database
    .collection('sessions')
    .createIndex({ dayKey: 1 })
    .catch(() => {})

  await database
    .collection('moves')
    .createIndex({ sessionId: 1, round: 1 })
    .catch(() => {})

  await database
    .collection('scores')
    .createIndex({ sessionId: 1 }, { unique: true })
    .catch(() => {})

  await database
    .collection('scores')
    .createIndex({ candidateAgentId: 1 })
    .catch(() => {})

  await database
    .collection('scores')
    .createIndex({ employerAgentId: 1 })
    .catch(() => {})
}

export async function getDb(): Promise<Db> {
  const { db } = await connect()
  return db
}

export async function getAgents(): Promise<Collection<Agent>> {
  const db = await getDb()
  return db.collection<Agent>('agents')
}

export async function getChallenges(): Promise<Collection<Challenge>> {
  const db = await getDb()
  return db.collection<Challenge>('challenges')
}

export async function getSessions(): Promise<Collection<Session>> {
  const db = await getDb()
  return db.collection<Session>('sessions')
}

export async function getMoves(): Promise<Collection<Move>> {
  const db = await getDb()
  return db.collection<Move>('moves')
}

export async function getScores(): Promise<Collection<Score>> {
  const db = await getDb()
  return db.collection<Score>('scores')
}

export async function getJobPostings(): Promise<Collection<JobPosting>> {
  const db = await getDb()
  return db.collection<JobPosting>('jobPostings')
}

export { ObjectId }
