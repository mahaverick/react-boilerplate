import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCurrentTenantSlug } from '@/hooks/use-current-tenant-slug'
import { useAuthStore } from '@/states/auth.store'
import { useCurrentTenantStore } from '@/states/current-tenant.store'
import { testUser } from '@/tests/mocks/handlers'

const url = vi.hoisted(() => ({
  slug: undefined as string | undefined,
  tenant: undefined as string | undefined,
}))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useParams: () => ({ slug: url.slug }),
  useSearch: ({ select }: { select: (search: { tenant?: string }) => unknown }) =>
    select({ tenant: url.tenant }),
}))

describe('useCurrentTenantSlug', () => {
  beforeEach(() => {
    localStorage.clear()
    url.slug = undefined
    url.tenant = undefined
    useCurrentTenantStore.setState({ remembered: {} })
    useAuthStore.setState({ user: testUser, isAuthenticated: true, isBootstrapped: true })
  })

  it('reads the route’s $slug', () => {
    url.slug = 'acme'
    const { result } = renderHook(() => useCurrentTenantSlug())
    expect(result.current).toBe('acme')
  })

  it('prefers $slug over a ?tenant', () => {
    url.slug = 'acme'
    url.tenant = 'globex'
    const { result } = renderHook(() => useCurrentTenantSlug())
    expect(result.current).toBe('acme')
  })

  it('reads ?tenant on a page without $slug', () => {
    url.tenant = 'globex'
    const { result } = renderHook(() => useCurrentTenantSlug())
    expect(result.current).toBe('globex')
  })

  it('is null when the URL names no tenant, whatever the store remembers', () => {
    useCurrentTenantStore.getState().remember(testUser.id, 'acme')
    const { result } = renderHook(() => useCurrentTenantSlug())
    expect(result.current).toBeNull()
  })
})
