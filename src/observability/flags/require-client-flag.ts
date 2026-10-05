/**
 * @file The route guard for a flag-gated page: the page does not exist while
 * its flag is off, as the gated API route answers 404 for it.
 */
import type { QueryClient } from '@tanstack/react-query'
import { notFound } from '@tanstack/react-router'
import { ensureFlags } from './flag-query'
import type { FlagScope } from './flag-scope'
import type { ClientFlagKey, ClientFlagValue } from './flag-types'

/**
 * For a route's `beforeLoad`: throws `notFound()` unless the flag has the
 * expected value. It loads the scope's values itself, since `beforeLoad` runs
 * before any loader, and a failed load means the fallback, so a gated page is
 * closed whenever the flags cannot be read.
 * @param queryClient - The app's query client.
 * @param scope - The scope the page reads its flags in.
 * @param key - The gating flag.
 * @param expected - The value that opens the page: true by default, or a
 *   multivariate flag's variant.
 */
export async function requireClientFlag<K extends ClientFlagKey>(
  queryClient: QueryClient,
  scope: FlagScope,
  key: K,
  expected?: ClientFlagValue<K>
): Promise<void> {
  const values = await ensureFlags(queryClient, scope)
  const opening: unknown = expected ?? true
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- notFound() is the plain object TanStack Router catches to render its not-found screen
  if (values[key] !== opening) throw notFound()
}
