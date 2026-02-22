import type { JobPosting } from '@/types'

const GREENHOUSE_SLUGS = [
  'stripe',
  'airbnb',
  'coinbase',
  'rippling',
  'brex',
  'figma',
  'notion',
  'linear',
  'vercel',
  'supabase',
  'retool',
  'airtable',
  'clickup',
  'lattice',
  'gusto',
  'ramp',
  'plaid',
  'scale',
  'anduril',
  'openai',
]

const LEVER_SLUGS = [
  'netflix',
  'shopify',
  'twitch',
  'discord',
  'robinhood',
  'chime',
  'duolingo',
  'canva',
  'figma',
  'gitlab',
]

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    return res
  } finally {
    clearTimeout(timer)
  }
}

export async function scrapeGreenhouse(slug: string): Promise<JobPosting[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`
  try {
    const res = await fetchWithTimeout(url)
    if (!res.ok) return []

    const data = (await res.json()) as { jobs?: unknown[] }
    if (!data.jobs || !Array.isArray(data.jobs)) return []

    return data.jobs
      .filter((job: unknown) => {
        const j = job as Record<string, unknown>
        return j.id && j.title
      })
      .map((job: unknown) => {
        const j = job as Record<string, unknown>
        const location = j.location as Record<string, unknown> | undefined
        return {
          source: 'greenhouse' as const,
          externalId: `greenhouse-${slug}-${j.id}`,
          company: slug.charAt(0).toUpperCase() + slug.slice(1),
          title: String(j.title),
          location: String(location?.name || 'Remote'),
          url: String(j.absolute_url || `https://boards.greenhouse.io/${slug}/jobs/${j.id}`),
          postedAt: j.updated_at ? new Date(String(j.updated_at)) : new Date(),
          rawData: j as Record<string, unknown>,
        }
      })
  } catch {
    return []
  }
}

export async function scrapeLever(slug: string): Promise<JobPosting[]> {
  const url = `https://api.lever.co/v0/postings/${slug}?mode=json`
  try {
    const res = await fetchWithTimeout(url)
    if (!res.ok) return []

    const data = (await res.json()) as unknown[]
    if (!Array.isArray(data)) return []

    return data
      .filter((job: unknown) => {
        const j = job as Record<string, unknown>
        return j.id && j.text
      })
      .map((job: unknown) => {
        const j = job as Record<string, unknown>
        const categories = j.categories as Record<string, unknown> | undefined
        return {
          source: 'lever' as const,
          externalId: `lever-${slug}-${j.id}`,
          company: slug.charAt(0).toUpperCase() + slug.slice(1),
          title: String(j.text),
          location: String(categories?.location || j.workplaceType || 'Remote'),
          url: String(j.hostedUrl || `https://jobs.lever.co/${slug}/${j.id}`),
          postedAt: j.createdAt ? new Date(Number(j.createdAt)) : new Date(),
          rawData: j as Record<string, unknown>,
        }
      })
  } catch {
    return []
  }
}

export async function scrapeAll(): Promise<JobPosting[]> {
  const results: JobPosting[] = []

  const greenhousePromises = GREENHOUSE_SLUGS.map((slug) =>
    scrapeGreenhouse(slug).then((jobs) => {
      console.log(`Greenhouse ${slug}: ${jobs.length} jobs`)
      results.push(...jobs)
    })
  )

  const leverPromises = LEVER_SLUGS.map((slug) =>
    scrapeLever(slug).then((jobs) => {
      console.log(`Lever ${slug}: ${jobs.length} jobs`)
      results.push(...jobs)
    })
  )

  await Promise.allSettled([...greenhousePromises, ...leverPromises])
  return results
}
