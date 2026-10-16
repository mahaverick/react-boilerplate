import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen, waitFor } from '@testing-library/react'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { TENANT_LOAD_ERROR, TenantGate } from '@/components/features/tenant/tenant-gate'
import { tenantKeys } from '@/queries/tenant.queries'
import { queryClient } from '@/router'
import { useAuthStore } from '@/states/auth.store'
import { readRememberedTenant, useCurrentTenantStore } from '@/states/current-tenant.store'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { fail, ok, tenantDetail, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const ACME = {
  id: TENANT_ID,
  name: 'Acme Corp',
  slug: 'acme',
  description: null,
  logo: null,
  website: null,
  lifecycleState: 'active',
  isPlatform: false,
  deletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

/**
 * Renders the gate for `slug` with the app's query client, inside a minimal
 * router because the not-found and suspended panels render `<Link>`.
 */
function renderGate(slug: string) {
  const rootRoute = createRootRoute({
    component: () => (
      <TenantGate slug={slug} skeleton={<p>Loading tenant</p>}>
        {(tenant) => <p>Loaded {tenant.name}</p>}
      </TenantGate>
    ),
  })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

describe('TenantGate', () => {
  beforeEach(() => {
    queryClient.clear()
    localStorage.clear()
    useCurrentTenantStore.setState({ remembered: {} })
    useAuthStore.setState({ user: testUser, isAuthenticated: true, isBootstrapped: true })
  })

  it('renders its children with the tenant, and remembers it', async () => {
    server.use(
      http.get('/api/v1/tenants/acme', () => ok(tenantDetail(ACME, 'owner'), 'Tenant retrieved.'))
    )
    renderGate('acme')
    expect(await screen.findByText('Loaded Acme Corp')).toBeInTheDocument()
    expect(readRememberedTenant(testUser.id)).toBe('acme')
  })

  it('says the tenant is not available on a 404, without remembering it', async () => {
    server.use(
      http.get('/api/v1/tenants/acme', () => fail('Tenant not found', 404)),
      http.get('/api/v1/tenants', () => ok([], 'Tenants.'))
    )
    renderGate('acme')
    expect(await screen.findByRole('heading', { name: 'Tenant not available' })).toBeInTheDocument()
    expect(readRememberedTenant(testUser.id)).toBeNull()
  })

  it('says a suspended tenant is suspended, from the tenant list, without remembering it', async () => {
    server.use(
      http.get('/api/v1/tenants/acme', () => fail('Tenant not found', 404)),
      http.get('/api/v1/tenants', () =>
        ok([{ tenant: { ...ACME, lifecycleState: 'suspended' }, role: 'owner' }], 'Tenants.')
      )
    )
    renderGate('acme')
    expect(await screen.findByRole('heading', { name: 'Tenant suspended' })).toBeInTheDocument()
    expect(screen.getByText('This tenant is suspended. Contact support.')).toBeInTheDocument()
    expect(readRememberedTenant(testUser.id)).toBeNull()
  })

  it('claims neither suspended nor missing when the tenant list fails too', async () => {
    server.use(
      http.get('/api/v1/tenants/acme', () => fail('Tenant not found', 404)),
      http.get('/api/v1/tenants', () => fail('Something went wrong.', 500))
    )
    renderGate('acme')
    expect(await screen.findByText(TENANT_LOAD_ERROR)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Tenant suspended' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Tenant not available' })).toBeNull()
  })

  it('a failed refetch with the tenant on screen shows no gate alert', async () => {
    let fails = false
    server.use(
      http.get('/api/v1/tenants/acme', () =>
        fails
          ? fail('Something went wrong.', 500)
          : ok(tenantDetail(ACME, 'owner'), 'Tenant retrieved.')
      )
    )
    renderGate('acme')
    expect(await screen.findByText('Loaded Acme Corp')).toBeInTheDocument()

    fails = true
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: tenantKeys.detail('acme'), exact: true })
    })

    await waitFor(() =>
      expect(queryClient.getQueryState(tenantKeys.detail('acme'))?.status).toBe('error')
    )
    expect(screen.getByText('Loaded Acme Corp')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('decides from a cached list whose refetch fails, with no load error above the panel', async () => {
    queryClient.setQueryData(tenantKeys.list, [])
    server.use(
      http.get('/api/v1/tenants/acme', () => fail('Tenant not found', 404)),
      http.get('/api/v1/tenants', () => fail('Something went wrong.', 500))
    )
    renderGate('acme')

    expect(await screen.findByRole('heading', { name: 'Tenant not available' })).toBeInTheDocument()
    // The 404 invalidated the list; once its refetch has failed, the panel still stands alone.
    await waitFor(() => expect(queryClient.getQueryState(tenantKeys.list)?.status).toBe('error'))
    expect(screen.getByRole('heading', { name: 'Tenant not available' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the platform-access banner, and does not replace the remembered tenant', async () => {
    useCurrentTenantStore.getState().remember(testUser.id, 'globex')
    server.use(
      http.get('/api/v1/tenants/acme', () =>
        ok(tenantDetail(ACME, 'viewer', 'platform'), 'Tenant retrieved.')
      )
    )
    renderGate('acme')
    expect(await screen.findByText('Loaded Acme Corp')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'You’re viewing Acme Corp as platform staff (Viewer).'
    )
    expect(readRememberedTenant(testUser.id)).toBe('globex')
    expect(useCurrentTenantStore.getState().remembered[testUser.id]).toBe('globex')
  })

  it('does not remember the platform tenant, even as a member of it', async () => {
    useCurrentTenantStore.getState().remember(testUser.id, 'globex')
    server.use(
      http.get('/api/v1/tenants/acme', () =>
        ok({ ...tenantDetail(ACME, 'owner'), isPlatform: true }, 'Tenant retrieved.')
      )
    )
    renderGate('acme')
    expect(await screen.findByText('Loaded Acme Corp')).toBeInTheDocument()
    expect(readRememberedTenant(testUser.id)).toBe('globex')
  })
})
