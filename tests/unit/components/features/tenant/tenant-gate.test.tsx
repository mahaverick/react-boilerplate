import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { TenantGate } from '@/components/features/tenant/tenant-gate'
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
    component: () => <TenantGate slug={slug}>{(tenant) => <p>Loaded {tenant.name}</p>}</TenantGate>,
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
})
