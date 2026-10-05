import { QueryClient } from '@tanstack/react-query'
import type { AnyRouter } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EXPOSURE_DEDUPE_PREFIX } from '@/observability/flags/exposure'
import { flagKeys } from '@/observability/flags/flag-query'
import { flagScopeFor, flagsPathFor, installFlagScopeReset } from '@/observability/flags/flag-scope'
import { TEST_FLAG_FALLBACKS } from '@/tests/mocks/handlers'

describe('flagScopeFor', () => {
  it('is the tenant on a tenant page and none elsewhere', () => {
    expect(flagScopeFor({ slug: 'acme' })).toEqual({ kind: 'tenant', slug: 'acme' })
    expect(flagScopeFor({})).toEqual({ kind: 'none' })
  })
})

describe('flagsPathFor', () => {
  it('maps each scope to its read endpoint', () => {
    expect(flagsPathFor({ kind: 'tenant', slug: 'acme' })).toBe('/tenants/acme/flags')
    expect(flagsPathFor({ kind: 'tenant', slug: 'a b' })).toBe('/tenants/a%20b/flags')
    expect(flagsPathFor({ kind: 'none' })).toBe('/flags')
    expect(flagsPathFor({ kind: 'platform' })).toBe('/platform/me/flags')
  })
})

describe('installFlagScopeReset', () => {
  let queryClient: QueryClient
  let onResolved: (() => void) | null
  let params: Record<string, string>

  /** Just the router surface the reset reads: `subscribe` and the last match's params. */
  const router = {
    subscribe: (_event: string, listener: () => void) => {
      onResolved = listener
      return () => {
        onResolved = null
      }
    },
    get state() {
      return { matches: [{ params }] }
    },
  } as unknown as AnyRouter

  function resolveAt(next: Record<string, string>) {
    params = next
    onResolved?.()
  }

  beforeEach(() => {
    queryClient = new QueryClient()
    window.sessionStorage.clear()
    queryClient.setQueryData(flagKeys.none(), TEST_FLAG_FALLBACKS)
    queryClient.setQueryData(flagKeys.tenant('acme'), TEST_FLAG_FALLBACKS)
    queryClient.setQueryData(flagKeys.tenant('globex'), TEST_FLAG_FALLBACKS)
  })

  afterEach(() => {
    queryClient.clear()
  })

  it('keeps everything while the reader stays on one tenant or leaves it', () => {
    const uninstall = installFlagScopeReset(router, queryClient)
    resolveAt({ slug: 'acme' })
    resolveAt({})
    resolveAt({ slug: 'acme' })
    expect(queryClient.getQueryCache().findAll({ queryKey: flagKeys.all })).toHaveLength(3)
    uninstall()
  })

  it('drops other scopes and the exposure marks on a switch, keeping the new tenant', () => {
    window.sessionStorage.setItem(`${EXPOSURE_DEDUPE_PREFIX}tenant:acme:k:v`, '1')
    const uninstall = installFlagScopeReset(router, queryClient)
    resolveAt({ slug: 'acme' })
    resolveAt({})
    resolveAt({ slug: 'globex' })
    const left = queryClient.getQueryCache().findAll({ queryKey: flagKeys.all })
    expect(left.map((query) => query.queryKey)).toEqual([['flags', 'tenant', 'globex']])
    expect(window.sessionStorage.getItem(`${EXPOSURE_DEDUPE_PREFIX}tenant:acme:k:v`)).toBeNull()
    uninstall()
  })
})
