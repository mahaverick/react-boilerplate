/**
 * The messages a failed dynamic import throws, matched by prefix: Chromium's,
 * Firefox's and Safari's. TanStack Router's own lazy-component reload matches
 * the same three.
 */
const CHUNK_LOAD_MESSAGES = [
  'Failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'Importing a module script failed',
] as const

/**
 * Whether `error` is a lazily loaded chunk that could not be fetched. After a
 * deploy the old hashed file names are gone, and only a reload of the page
 * picks up the new ones.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return CHUNK_LOAD_MESSAGES.some((prefix) => error.message.startsWith(prefix))
}
