import { formatError } from '@/lib/db'

/**
 * Log a route-level error with all MongoDB / Node error fields.
 * Use this in every API route catch block instead of console.error(err).
 */
export function logRouteError(route: string, err: unknown): void {
  const structured = formatError(err)
  console.error(`[${route}] error:`, JSON.stringify(structured))
}
