/**
 * @file The flags query: one per scope, read from the server, which is the
 * only evaluator. A failed or malformed read never reaches a page as an
 * error: every reader falls back to the registry fallbacks.
 */
import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { apiClient } from '@/http/client'
import { flagsPathFor, type FlagScope } from './flag-scope'
import type { ClientFlagValues } from './flag-types'
import { fallbackFlags, normalizeFlags } from './flag-values'

/** How long a scope's values are fresh; a focus refetches only once they are stale. */
export const FLAGS_STALE_MS = 5 * 60_000

/** How often an open page refetches its scope's values. */
export const FLAGS_REFETCH_MS = 10 * 60_000

/** Query keys, all under `['flags']` so one call removes every scope. */
export const flagKeys = {
  all: ['flags'] as const,
  tenant: (slug: string) => ['flags', 'tenant', slug] as const,
  none: () => ['flags', 'none'] as const,
  platform: () => ['flags', 'platform'] as const,
}

/**
 * The query key for a scope.
 * @param scope - The scope.
 * @returns Its key under `flagKeys.all`.
 */
export function flagKeyFor(scope: FlagScope): readonly string[] {
  switch (scope.kind) {
    case 'tenant':
      return flagKeys.tenant(scope.slug)
    case 'none':
      return flagKeys.none()
    case 'platform':
      return flagKeys.platform()
  }
}

/**
 * A scope as one string, for the exposure dedupe and effect dependencies.
 * @param scope - The scope.
 * @returns `tenant:<slug>`, `none` or `platform`.
 */
export function flagScopeId(scope: FlagScope): string {
  return scope.kind === 'tenant' ? `tenant:${scope.slug}` : scope.kind
}

/** The read endpoints' answer inside the API's success envelope. */
interface FlagsEnvelope {
  data?: { flags?: unknown; evaluatedAt?: unknown }
}

/**
 * Reads a scope's values from the server and checks them against
 * `CLIENT_FLAGS` (`normalizeFlags`).
 * @param scope - The scope.
 * @param signal - Aborts the request.
 * @returns A value for every flag this app reads.
 * @throws When the request fails or the answer has no `flags` object.
 */
export async function fetchFlags(
  scope: FlagScope,
  signal?: AbortSignal
): Promise<ClientFlagValues> {
  const response = await apiClient.get<FlagsEnvelope>(flagsPathFor(scope), { signal })
  const flags = response.data.data?.flags
  if (typeof flags !== 'object' || flags === null || Array.isArray(flags)) {
    throw new Error('The flags response has no flags object.')
  }
  return normalizeFlags(flags as Record<string, unknown>)
}

/**
 * The query for a scope. No retry: a failed read resolves to fallbacks at
 * once rather than holding a loader for the retry delay, and the next focus
 * or interval tries again.
 * @param scope - The scope.
 * @returns Options for `useQuery` and `ensureQueryData`.
 */
export function flagsQueryOptions(scope: FlagScope) {
  return queryOptions({
    queryKey: flagKeyFor(scope),
    queryFn: ({ signal }) => fetchFlags(scope, signal),
    staleTime: FLAGS_STALE_MS,
    refetchInterval: FLAGS_REFETCH_MS,
    refetchOnWindowFocus: true,
    retry: false,
  })
}

/**
 * Loads a scope's values for a route loader. Never rejects: a failed read
 * resolves to the fallbacks, so flags never block a page from rendering.
 * @param queryClient - The app's query client.
 * @param scope - The scope.
 * @returns The values, or every fallback.
 */
export async function ensureFlags(
  queryClient: QueryClient,
  scope: FlagScope
): Promise<ClientFlagValues> {
  try {
    return await queryClient.ensureQueryData(flagsQueryOptions(scope))
  } catch {
    return fallbackFlags()
  }
}

/**
 * Removes flag values from the cache: every scope's on a sign-in, sign-out
 * or user change, so nobody sees the last person's values, or every scope but
 * `keep` on a tenant switch.
 * @param queryClient - The app's query client.
 * @param options - `keep`, a scope whose values stay.
 */
export function clearFlags(queryClient: QueryClient, options: { keep?: FlagScope } = {}): void {
  const kept = options.keep ? JSON.stringify(flagKeyFor(options.keep)) : null
  queryClient.removeQueries({
    queryKey: flagKeys.all,
    predicate: (query) => kept === null || JSON.stringify(query.queryKey) !== kept,
  })
}
