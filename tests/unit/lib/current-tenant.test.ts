import type { AnyRouter } from '@tanstack/react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { installCurrentTenant, retainTenant, type TenantSearch } from '@/lib/current-tenant'

/** What the router hands an `onBeforeLoad` listener, as far as the hook reads it. */
type BeforeLoad = (event: { toLocation: { pathname: string; search: unknown } }) => void

let uninstall: (() => void) | null = null

afterEach(() => {
  uninstall?.()
  uninstall = null
})

/**
 * Installs the hook on a stub router whose routes match no `$slug`, and returns
 * a function that announces a load of `search`.
 */
function installOnStub(): (search: unknown) => void {
  let listener: BeforeLoad | undefined
  const router = {
    getMatchedRoutes: () => [[], {}],
    subscribe: (_event: string, fn: BeforeLoad) => {
      listener = fn
      return () => {}
    },
  } as unknown as AnyRouter
  uninstall = installCurrentTenant(router)
  return (search) => listener?.({ toLocation: { pathname: '/dashboard', search } })
}

/** What `retainTenant` builds for a bare link from a page whose search is `{}`. */
function bareLink(): TenantSearch {
  return retainTenant({
    search: {},
    next: (() => ({ search: {}, meta: {} })) as never,
  })
}

describe('installCurrentTenant', () => {
  it('records a slug-shaped ?tenant, which a bare link then carries', () => {
    installOnStub()({ tenant: 'acme' })
    expect(bareLink()).toEqual({ tenant: 'acme' })
  })

  it.each([
    ['not slug-shaped', 'Not A Slug'],
    ['empty', ''],
    ['a number', 12345],
    ['null', null],
    ['a boolean', true],
  ])('records nothing for a ?tenant that is %s', (_label, tenant) => {
    installOnStub()({ tenant })
    expect(bareLink()).toEqual({})
  })
})
