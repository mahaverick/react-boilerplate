import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
  type RouterHistory,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { installCurrentTenant } from '@/lib/current-tenant'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { useCurrentTenantStore } from '@/states/current-tenant.store'
import { TENANT_ID, TENANT_ID_2 } from '@/tests/fixtures/ids'
import { fail, ok, tenantDetail, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/** A tenant row as `GET /tenants` and `GET /tenants/:slug` carry it. */
function tenantRow(id: string, name: string, slug: string, lifecycleState = 'active') {
  return {
    id,
    name,
    slug,
    description: null,
    logo: null,
    website: null,
    lifecycleState,
    isPlatform: false,
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const ACME = tenantRow(TENANT_ID, 'Acme Corp', 'acme')
const GLOBEX = tenantRow(TENANT_ID_2, 'Globex', 'globex')

/** A `GET /tenants` row for `tenant`, as an owner. */
function listed(tenant: ReturnType<typeof tenantRow>) {
  return { tenant, role: 'owner', isPlatform: tenant.isPlatform }
}

/** Serves `rows` as the caller's tenant list, and each row's detail. */
function serveTenants(rows: ReturnType<typeof tenantRow>[]) {
  server.use(
    http.get('/api/v1/tenants', () => ok(rows.map(listed), 'Tenants retrieved.')),
    ...rows.map((row) =>
      http.get(`/api/v1/tenants/${row.slug}`, () =>
        ok(tenantDetail(row, 'owner'), 'Tenant retrieved.')
      )
    )
  )
}

/** Signs `user` in, as the session restore leaves the store. */
function signIn(user = testUser) {
  useAuthStore.setState({
    accessToken: 'access-token',
    user,
    isAuthenticated: true,
    isBootstrapped: true,
  })
}

let uninstall: (() => void) | null = null

/** Mounts the real route tree at `path`, with the current-tenant hook the app's router installs. */
function renderAt(path: string): { router: AnyRouter; history: RouterHistory } {
  const history = createMemoryHistory({ initialEntries: [path] })
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history,
    ...ROUTER_DEFAULTS,
  }) as unknown as AnyRouter
  uninstall = installCurrentTenant(router)
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return { router, history }
}

/** Waits until the router has settled on `href`. */
async function expectHref(router: AnyRouter, href: string) {
  await waitFor(() => {
    expect(router.state.location.href).toBe(href)
    expect(router.state.status).toBe('idle')
  })
}

beforeEach(() => {
  resetSessionForTests()
  queryClient.clear()
  localStorage.clear()
  useCurrentTenantStore.setState({ remembered: {} })
  signIn()
})

afterEach(() => {
  uninstall?.()
  uninstall = null
  vi.restoreAllMocks()
})

describe('TenantSearchGuard', () => {
  it('shows the list template on /tenants while the list is in flight, the same one its route pends with', async () => {
    server.use(
      http.get('/api/v1/tenants', async () => {
        await new Promise<void>(() => undefined)
        return ok([], 'Tenants retrieved.')
      })
    )
    renderAt('/tenants')

    const status = await screen.findByRole('status', { name: 'Loading' })
    expect(status).toHaveAttribute('data-variant', 'list')
    expect(status).toHaveAttribute('data-nested', 'false')
    expect(screen.getByRole('navigation', { name: 'Tenant' })).toBeInTheDocument()
  })

  it('shows the dashboard template in the page slot, under the real sidebar, while the list is in flight', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.get('/api/v1/tenants', async () => {
        await held
        return ok([listed(ACME)], 'Tenants retrieved.')
      })
    )
    const { router } = renderAt('/dashboard')

    expect(await screen.findByRole('status', { name: 'Loading' })).toHaveAttribute(
      'data-variant',
      'dashboard'
    )
    expect(screen.getByRole('navigation', { name: 'Tenant' })).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { level: 1, name: /Welcome back/ })
    ).not.toBeInTheDocument()

    release()
    await expectHref(router, '/dashboard?tenant=acme')
    expect(await screen.findByRole('heading', { level: 1, name: /Welcome back/ })).toBeVisible()
  })

  it('fills the only tenant, replacing the entry', async () => {
    serveTenants([ACME])
    const { router, history } = renderAt('/settings/account/profile')
    await expectHref(router, '/settings/account/profile?tenant=acme')
    expect(history.length).toBe(1)
  })

  it('removes ?tenant for a user who must choose a tenant (none eligible)', async () => {
    serveTenants([])
    const { router } = renderAt('/dashboard?tenant=acme')
    await expectHref(router, '/dashboard')
    expect(
      await screen.findByRole('combobox', { name: 'Switch tenant. Current: Choose a tenant' })
    ).toBeVisible()
  })

  it('replaces a tenant that is not found in the list with the first eligible one', async () => {
    serveTenants([ACME, GLOBEX])
    const { router } = renderAt('/notifications?tenant=initech')
    await expectHref(router, '/notifications?tenant=acme')
  })

  it('renders the page on the list’s first failure, without waiting for its retry', async () => {
    let attempts = 0
    server.use(
      http.get('/api/v1/tenants', () => {
        attempts += 1
        // The retry never answers: the page must not be waiting on it.
        return attempts === 1 ? fail('Something went wrong.', 500) : new Promise<Response>(() => {})
      })
    )
    const { router } = renderAt('/dashboard?tenant=acme')

    expect(await screen.findByRole('heading', { level: 1, name: /Welcome back/ })).toBeVisible()
    expect(router.state.location.href).toBe('/dashboard?tenant=acme')
  })

  it('moves between tenant pages and pages without $slug with no correction of its own', async () => {
    serveTenants([ACME, GLOBEX])
    const { router, history } = renderAt('/dashboard?tenant=acme')
    expect(await screen.findByRole('heading', { level: 1, name: /Welcome back/ })).toBeVisible()

    await router.navigate({ to: '/tenants/$slug', params: { slug: 'globex' } })
    expect(await screen.findByRole('heading', { level: 1, name: 'Globex' })).toBeVisible()
    await expectHref(router, '/tenants/globex')

    await router.navigate({ to: '/dashboard' })
    expect(await screen.findByRole('heading', { level: 1, name: /Welcome back/ })).toBeVisible()
    // The carried tenant is globex's, never a correction back toward acme, and no entry was added or replaced.
    await expectHref(router, '/dashboard?tenant=globex')
    expect(history.length).toBe(3)
    expect(useCurrentTenantStore.getState().remembered[testUser.id]).toBe('globex')
  })

  it('never holds a $slug page on the dashboard template, and only drops ?tenant there', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.get('/api/v1/tenants', async () => {
        await held
        return ok([listed(ACME)], 'Tenants retrieved.')
      }),
      http.get('/api/v1/tenants/acme', () => ok(tenantDetail(ACME, 'owner'), 'Tenant retrieved.'))
    )
    const { router } = renderAt('/tenants/acme?tenant=globex')
    // The page renders while the list is still held: the guard never waits on it here.
    expect(await screen.findByRole('heading', { level: 1, name: 'Acme Corp' })).toBeVisible()
    await expectHref(router, '/tenants/acme')
    release()
  })
})
