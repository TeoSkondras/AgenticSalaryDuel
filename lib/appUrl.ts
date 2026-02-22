/** Return a fully-qualified base URL, always with https:// in production. */
export function getAppUrl(): string {
  const raw = process.env.APP_URL || 'http://localhost:3000'
  // If the value has no protocol, add https://
  if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
    return `https://${raw}`
  }
  return raw
}
