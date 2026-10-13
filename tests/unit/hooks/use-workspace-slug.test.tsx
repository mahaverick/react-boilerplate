import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceSlug } from '@/hooks/use-workspace-slug'
import { queryClient } from '@/router'
import { useAuthStore } from '@/states/auth.store'
import { useCurrentTenantStore } from '@/states/current-tenant.store'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const params = vi.hoisted(() => ({ slug: undefined as string | undefined }))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useParams: () => ({ slug: params.slug }),
}))

/** A tenant list row, active unless `lifecycleState` says otherwise. */
function row(slug: string, lifecycleState = 'active', isPlatform = false) {
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
      isPlatform,
    },
    role: 'owner',
    isPlatform,
  }
}

/** The app's query client, so the hook reads `useTenants` as the app does. */
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useWorkspaceSlug', () => {
  beforeEach(() => {
    queryClient.clear()
    localStorage.clear()
    params.slug = undefined
    useCurrentTenantStore.setState({ remembered: {} })
    useAuthStore.setState({ user: testUser, isAuthenticated: true, isBootstrapped: true })
  })

  it('prefers the route’s tenant', () => {
    params.slug = 'acme'
    const { result } = renderHook(() => useWorkspaceSlug(), { wrapper })
    expect(result.current).toBe('acme')
  })

  it('falls back to the remembered tenant the user still belongs to', async () => {
    server.use(http.get('/api/v1/tenants', () => ok([row('acme')], 'Tenants.')))
    useCurrentTenantStore.getState().remember(testUser.id, 'acme')
    const { result } = renderHook(() => useWorkspaceSlug(), { wrapper })
    await waitFor(() => expect(result.current).toBe('acme'))
  })

  it('ignores a remembered tenant the user no longer belongs to', async () => {
    server.use(http.get('/api/v1/tenants', () => ok([row('globex')], 'Tenants.')))
    useCurrentTenantStore.getState().remember(testUser.id, 'acme')
    const { result } = renderHook(() => useWorkspaceSlug(), { wrapper })
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(result.current).toBeNull()
  })

  it('ignores a remembered tenant that is suspended or the platform tenant', async () => {
    server.use(
      http.get('/api/v1/tenants', () =>
        ok([row('acme', 'suspended'), row('platform', 'active', true)], 'Tenants.')
      )
    )
    useCurrentTenantStore.getState().remember(testUser.id, 'acme')
    const first = renderHook(() => useWorkspaceSlug(), { wrapper })
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(first.result.current).toBeNull()
    useCurrentTenantStore.getState().remember(testUser.id, 'platform')
    const second = renderHook(() => useWorkspaceSlug(), { wrapper })
    expect(second.result.current).toBeNull()
  })

  it('is null with nothing remembered', () => {
    const { result } = renderHook(() => useWorkspaceSlug(), { wrapper })
    expect(result.current).toBeNull()
  })
})
