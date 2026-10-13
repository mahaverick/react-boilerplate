import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { delay, http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCurrentTenantSlug } from '@/hooks/use-current-tenant-slug'
import { queryClient } from '@/router'
import { useAuthStore } from '@/states/auth.store'
import { useCurrentTenantStore } from '@/states/current-tenant.store'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

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

/** A tenant list row, active unless `lifecycleState` says otherwise. */
function row(slug: string, lifecycleState = 'active') {
  return {
    tenant: {
      id: `${TENANT_ID}-${slug}`,
      name: slug,
      slug,
      description: null,
      logo: null,
      website: null,
      lifecycleState,
      deletedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      isPlatform: false,
    },
    role: 'owner',
    isPlatform: false,
  }
}

/** The app's query client, so the hook reads `useTenants` as the app does. */
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

/** Renders the hook and waits until the tenant list query has settled. */
async function renderSettled() {
  const hook = renderHook(() => useCurrentTenantSlug(), { wrapper })
  await waitFor(() => expect(queryClient.isFetching()).toBe(0))
  return hook
}

describe('useCurrentTenantSlug', () => {
  beforeEach(() => {
    queryClient.clear()
    localStorage.clear()
    url.slug = undefined
    url.tenant = undefined
    useCurrentTenantStore.setState({ remembered: {} })
    useAuthStore.setState({ user: testUser, isAuthenticated: true, isBootstrapped: true })
    server.use(http.get('/api/v1/tenants', () => ok([row('acme'), row('umbrella', 'suspended')])))
  })

  it('reads the route’s $slug, even one the list lacks (platform access)', async () => {
    url.slug = 'globex'
    const { result } = await renderSettled()
    expect(result.current).toBe('globex')
  })

  it('prefers $slug over a ?tenant', async () => {
    url.slug = 'acme'
    url.tenant = 'globex'
    const { result } = await renderSettled()
    expect(result.current).toBe('acme')
  })

  it('reads ?tenant on a page without $slug', async () => {
    url.tenant = 'acme'
    const { result } = await renderSettled()
    expect(result.current).toBe('acme')
  })

  it('trusts ?tenant while the list is still loading', () => {
    server.use(http.get('/api/v1/tenants', () => delay('infinite')))
    url.tenant = 'acme'
    const { result } = renderHook(() => useCurrentTenantSlug(), { wrapper })
    expect(result.current).toBe('acme')
  })

  it.each([
    ['absent from the loaded list', 'globex'],
    ['suspended', 'umbrella'],
  ])('is null for a ?tenant that is %s', async (_label, tenant) => {
    url.tenant = tenant
    const { result } = await renderSettled()
    expect(result.current).toBeNull()
  })

  it('is null when the URL names no tenant, whatever the store remembers', async () => {
    useCurrentTenantStore.getState().remember(testUser.id, 'acme')
    const { result } = await renderSettled()
    expect(result.current).toBeNull()
  })
})
