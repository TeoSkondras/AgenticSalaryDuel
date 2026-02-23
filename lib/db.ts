import { MongoClient, Db, Collection, ObjectId, MongoClientOptions } from 'mongodb'
import type { Agent, Challenge, Session, Move, Score, JobPosting } from '@/types'

function resolveDbName(): string {
  return process.env.MONGODB_DB || 'agenticsalaryduel'
}

// Connection caching for Next.js HMR
let client: MongoClient | undefined
let db: Db | undefined
let connecting: Promise<{ client: MongoClient; db: Db }> | undefined

declare global {
  // eslint-disable-next-line no-var
  var _mongoClient: MongoClient | undefined
  // eslint-disable-next-line no-var
  var _mongoDb: Db | undefined
}

/** Extract every useful field from any error object for structured logging. */
function formatError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const e = err as Error & {
      code?: string | number
      codeName?: string
      errorLabels?: string[]
      cause?: unknown
    }
    return {
      name: e.name,
      message: e.message,
      code: e.code,
      codeName: e.codeName,
      errorLabels: e.errorLabels,
      stack: e.stack,
      cause: e.cause ? formatError(e.cause) : undefined,
    }
  }
  return { raw: String(err) }
}

/** Attach driver-level topology / heartbeat / pool event listeners for observability. */
function attachMongoListeners(c: MongoClient, label: string): void {
  c.on('serverOpening', (e) =>
    console.log(`[db][${label}] serverOpening address=${e.address}`)
  )
  c.on('serverClosed', (e) =>
    console.log(`[db][${label}] serverClosed address=${e.address}`)
  )
  c.on('serverHeartbeatFailed', (e) =>
    console.error(`[db][${label}] serverHeartbeatFailed address=${e.connectionId}`, formatError(e.failure))
  )
  c.on('serverHeartbeatSucceeded', (e) =>
    console.log(`[db][${label}] serverHeartbeatSucceeded address=${e.connectionId} duration=${e.duration}ms`)
  )
  c.on('topologyDescriptionChanged', (e) => {
    const servers = [...e.newDescription.servers.entries()]
      .map(([addr, desc]) => `${addr}(${desc.type})`)
      .join(', ')
    console.log(`[db][${label}] topologyDescriptionChanged servers=[${servers}]`)
  })
  c.on('connectionPoolCreated', (e) =>
    console.log(`[db][${label}] connectionPoolCreated address=${e.address}`)
  )
  c.on('connectionCheckOutFailed', (e) =>
    console.error(`[db][${label}] connectionCheckOutFailed address=${e.address} reason=${e.reason}`)
  )
  c.on('error', (err) =>
    console.error(`[db][${label}] client error`, formatError(err))
  )
}

async function connect(): Promise<{ client: MongoClient; db: Db }> {
  const uri = process.env.MONGODB_URI
  const dbName = resolveDbName()
  if (!uri) {
    console.error('[db] MONGODB_URI is not set — check Railway environment variables')
    throw new Error('MONGODB_URI environment variable is not set')
  }

  // Log a redacted URI so we can confirm which cluster/user without exposing the password
  const redacted = uri.replace(/:\/\/([^:]+):([^@]+)@/, '://<user>:<redacted>@')
  console.log(`[db] connecting: NODE_ENV=${process.env.NODE_ENV} dbName=${dbName} uri=${redacted}`)

  const clientOptions: MongoClientOptions = {
    // Surface connection errors faster on Railway (default is 30s)
    connectTimeoutMS: 15000,
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 30000,
  }

  if (process.env.NODE_ENV === 'development') {
    if (!global._mongoClient || !global._mongoDb) {
      console.log('[db] dev: creating new MongoClient')
      const devClient = new MongoClient(uri, clientOptions)
      attachMongoListeners(devClient, 'dev')
      try {
        await devClient.connect()
      } catch (err) {
        console.error('[db] dev: connect() failed', formatError(err))
        throw err
      }
      const devDb = devClient.db(dbName)
      await ensureIndexes(devDb)
      global._mongoClient = devClient
      global._mongoDb = devDb
      console.log('[db] dev: connected and ready')
    } else {
      console.log('[db] dev: reusing cached connection')
    }
    return { client: global._mongoClient!, db: global._mongoDb! }
  }

  // Production: deduplicate concurrent connect() calls
  if (client && db) {
    return { client, db }
  }

  if (!connecting) {
    console.log('[db] prod: initiating new MongoClient')
    connecting = (async () => {
      const prodClient = new MongoClient(uri, clientOptions)
      attachMongoListeners(prodClient, 'prod')
      try {
        await prodClient.connect()
      } catch (err) {
        console.error('[db] prod: connect() failed', formatError(err))
        throw err
      }
      const prodDb = prodClient.db(dbName)
      await ensureIndexes(prodDb)
      client = prodClient
      db = prodDb
      console.log('[db] prod: connected and ready')
      return { client: prodClient, db: prodDb }
    })().catch((err) => {
      console.error('[db] prod: connection setup failed, resetting state', formatError(err))
      client = undefined
      db = undefined
      connecting = undefined
      throw err
    })
  }

  return connecting
}

async function ensureIndexes(database: Db): Promise<void> {
  console.log('[db] ensureIndexes: start')

  // Drop stale indexes from old schema (renamed fields)
  await database.collection('agents').dropIndex('apiKeyHash_1').catch(() => {})
  await database.collection('agents').dropIndex('name_1').catch(() => {})

  // Remove corrupted agent documents that have null handle or tokenHash.
  // These break unique index creation (multiple nulls violate uniqueness).
  const { deletedCount } = await database.collection('agents').deleteMany({
    $or: [{ handle: null }, { tokenHash: null }],
  })
  if (deletedCount > 0) {
    console.log(`[db] ensureIndexes: removed ${deletedCount} corrupted agent doc(s) with null handle/tokenHash`)
  }

  const indexOps: Array<{ collection: string; keys: Record<string, unknown>; options?: Record<string, unknown> }> = [
    { collection: 'agents', keys: { handle: 1 }, options: { unique: true } },
    { collection: 'agents', keys: { tokenHash: 1 }, options: { unique: true } },
    { collection: 'challenges', keys: { dayKey: 1, index: 1 }, options: { unique: true } },
    { collection: 'challenges', keys: { status: 1 } },
    { collection: 'sessions', keys: { challengeId: 1 } },
    { collection: 'sessions', keys: { dayKey: 1 } },
    { collection: 'moves', keys: { sessionId: 1, round: 1 } },
    { collection: 'scores', keys: { sessionId: 1 }, options: { unique: true } },
    { collection: 'scores', keys: { candidateAgentId: 1 } },
    { collection: 'scores', keys: { employerAgentId: 1 } },
  ]

  for (const op of indexOps) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await database.collection(op.collection).createIndex(op.keys as any, op.options ?? {})
    } catch (err) {
      // Index already exists with the same definition → not a real error
      const e = err as { codeName?: string; code?: number }
      if (e.codeName === 'IndexAlreadyExists' || e.code === 85 || e.code === 86) {
        // fine — existing identical index
      } else {
        console.warn(
          `[db] ensureIndexes: createIndex failed on ${op.collection}`,
          formatError(err)
        )
      }
    }
  }

  console.log('[db] ensureIndexes: done')
}

export async function getDb(): Promise<Db> {
  const result = await connect()
  return result.db
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

export { ObjectId, formatError }
