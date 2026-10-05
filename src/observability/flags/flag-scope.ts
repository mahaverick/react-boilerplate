/**
 * @file Which flags read a page uses, owned by this app: a tenant page reads
 * the tenant's flags, every other page the user's flags with no tenant.
 */
import type { QueryClient } from '@tanstack/react-query'
import { useParams, type AnyRouter } from '@tanstack/react-router'
import { useMemo } from 'react'
import { clearExposureDedupe } from './exposure'
// Import cycle (flag-scope → flag-query → flag-scope): safe, as each reads the other only inside functions.
import { clearFlags } from './flag-query'

/** Where a flags read is evaluated: in a tenant, with no tenant, or for staff in Apex. */
export type FlagScope = { kind: 'tenant'; slug: string } | { kind: 'none' } | { kind: 'platform' }

/**
 * The scope for a route's params: the tenant in `$slug`, or none.
 * @param params - Any matched route's params; a parent route's include its children's.
 * @returns The scope.
 */
export function flagScopeFor(params: { slug?: string }): FlagScope {
  return params.slug === undefined ? { kind: 'none' } : { kind: 'tenant', slug: params.slug }
}

/**
 * The current page's scope, stable across renders while `$slug` is unchanged.
 * @returns The scope.
 */
export function useFlagScope(): FlagScope {
  const { slug } = useParams({ strict: false })
  return useMemo(() => flagScopeFor({ slug }), [slug])
}

/**
 * The API path that answers a scope's flags; its exposure endpoint is this
 * path plus `/exposures`.
 * @param scope - The scope.
 * @returns A path under `API_PREFIX`.
 */
export function flagsPathFor(scope: FlagScope): string {
  switch (scope.kind) {
    case 'tenant':
      return `/tenants/${encodeURIComponent(scope.slug)}/flags`
    case 'none':
      return '/flags'
    case 'platform':
      return '/platform/me/flags'
  }
}

/**
 * Drops every other scope's flag values and the exposure dedupe whenever a
 * navigation resolves on a different tenant from the last one, so returning
 * to a tenant reads its flags afresh. On resolve, not in a loader: a loader
 * also runs for a hovered link's preload. The resolved tenant's own values
 * are kept, so its page never flashes its fallbacks.
 * @param router - The app's router.
 * @param queryClient - The client holding the flag queries.
 * @returns The unsubscribe.
 */
export function installFlagScopeReset(router: AnyRouter, queryClient: QueryClient): () => void {
  let lastTenant: string | null = null
  return router.subscribe('onResolved', () => {
    const params = (router.state.matches.at(-1)?.params ?? {}) as { slug?: string }
    const scope = flagScopeFor(params)
    if (scope.kind !== 'tenant') return
    if (lastTenant !== null && lastTenant !== scope.slug) {
      clearFlags(queryClient, { keep: scope })
      clearExposureDedupe()
    }
    lastTenant = scope.slug
  })
}
