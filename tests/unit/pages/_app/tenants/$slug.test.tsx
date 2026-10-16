import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MembershipRole } from '@/constants/roles'
import { resetSessionForTests } from '@/http/session'
import { installRouteAnalytics } from '@/observability/route-telemetry'
import * as analytics from '@/observability/telemetry'
import { tenantKeys } from '@/queries/tenant.queries'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, tenantDetail, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { TenantAccess } from '@/types/api.types'

afterEach(() => {
  vi.restoreAllMocks()
})

const TENANT = {
  id: TENANT_ID,
  name: 'Acme Corp',
  slug: 'acme',
  description: 'Anvils',
  logo: null,
  website: 'https://acme.test',
  lifecycleState: 'active',
  deletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const SETTINGS = {
  tenantId: TENANT_ID,
  timezone: 'Europe/London',
  locale: 'en',
  metadata: { tier: 'pro' },
  updatedAt: '2026-01-01T00:00:00.000Z',
}

/** Serves the acme tenant, its list entry, members and settings, with the caller holding `myRole` through `access`. */
function mockTenant(myRole: MembershipRole, access: TenantAccess = 'member') {
  server.use(
    http.get('/api/v1/tenants', () => ok([{ tenant: TENANT, role: myRole }], 'Tenants retrieved.')),
    http.get('/api/v1/tenants/acme', () =>
      ok(tenantDetail(TENANT, myRole, access), 'Tenant retrieved.')
    ),
    http.get('/api/v1/tenants/acme/members', () => ok([], 'Members retrieved.')),
    http.get('/api/v1/tenants/acme/settings', () => ok(SETTINGS, 'Settings retrieved.'))
  )
}

/** Mounts the real route tree at `path` and returns the router. */
function renderAppAt(path: string): AnyRouter {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
    ...ROUTER_DEFAULTS,
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return router as AnyRouter
}

describe('tenant detail', () => {
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
  })

  it('ends on the suspended panel when the cached list still says active', async () => {
    let listFetches = 0
    queryClient.setQueryData(tenantKeys.list, [{ tenant: TENANT, role: 'owner' }])
    server.use(
      http.get('/api/v1/tenants', () => {
        listFetches += 1
        return ok(
          [{ tenant: { ...TENANT, lifecycleState: 'suspended' }, role: 'owner' }],
          'Tenants.'
        )
      }),
      http.get('/api/v1/tenants/acme', () => fail('Tenant not found', 404))
    )
    renderAppAt('/tenants/acme')

    const seen: boolean[] = []
    const observer = new MutationObserver(() =>
      seen.push(/not one of yours|Tenant not available/.test(document.body.textContent))
    )
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    try {
      await screen.findByRole('heading', { name: 'Tenant suspended', level: 1 })
    } finally {
      observer.disconnect()
    }
    expect(seen).not.toContain(true)
    await settle(200, 'a refetch loop has no event to await')
    expect(listFetches).toBeLessThanOrEqual(2)
  })

  it('still says not found for a tenant the refreshed list does not carry', async () => {
    queryClient.setQueryData(tenantKeys.list, [{ tenant: TENANT, role: 'owner' }])
    server.use(
      http.get('/api/v1/tenants', () => ok([], 'Tenants.')),
      http.get('/api/v1/tenants/acme', () => fail('Tenant not found', 404))
    )
    renderAppAt('/tenants/acme')
    expect(await screen.findByText(/not one of yours/)).toBeInTheDocument()
  })

  /**
   * `tenantQueryOptions` turns a 404 into `null`, and every other failure still rejects and
   * reaches the gate's load-error panel, with a retry, inside the app's chrome.
   */
  it('renders the load-error panel, with a retry, for a non-404 failure', async () => {
    server.use(
      http.get('/api/v1/tenants', () => ok([], 'Tenants retrieved.')),
      http.get('/api/v1/tenants/acme', () => fail('Something went wrong', 500))
    )
    renderAppAt('/tenants/acme')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not load this tenant/i)
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    // Not the 404 panel: the tenant may exist and merely be unreachable.
    expect(screen.queryByText(/Tenant not available/i)).not.toBeInTheDocument()
  })

  it('says a suspended tenant is suspended, not that it is missing', async () => {
    server.use(
      http.get('/api/v1/tenants', () =>
        ok([{ tenant: { ...TENANT, lifecycleState: 'suspended' }, role: 'owner' }], 'Tenants.')
      ),
      http.get('/api/v1/tenants/acme', () => fail('Tenant not found', 404))
    )
    renderAppAt('/tenants/acme')
    expect(
      await screen.findByRole('heading', { name: 'Tenant suspended', level: 1 })
    ).toBeInTheDocument()
    expect(screen.getByText('This tenant is suspended. Contact support.')).toBeInTheDocument()
    expect(screen.queryByText(/not one of yours/)).not.toBeInTheDocument()
  })

  it('shows no not-found text while the tenant list is still loading, then the suspended panel', async () => {
    server.use(
      http.get('/api/v1/tenants', async () => {
        await settle(150, 'delays the list so the loader resolves first')
        return ok(
          [{ tenant: { ...TENANT, lifecycleState: 'suspended' }, role: 'owner' }],
          'Tenants.'
        )
      }),
      http.get('/api/v1/tenants/acme', () => fail('Tenant not found', 404))
    )
    renderAppAt('/tenants/acme')

    const seen: boolean[] = []
    const observer = new MutationObserver(() =>
      seen.push(/not one of yours|Tenant not available/.test(document.body.textContent))
    )
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    try {
      await screen.findByRole('heading', { name: 'Tenant suspended', level: 1 })
    } finally {
      observer.disconnect()
    }
    expect(seen).not.toContain(true)
  })

  it('claims neither suspended nor missing when the tenant list fails', async () => {
    server.use(
      http.get('/api/v1/tenants', () => fail('Something went wrong', 500)),
      http.get('/api/v1/tenants/acme', () => fail('Tenant not found', 404))
    )
    renderAppAt('/tenants/acme')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not load this tenant/i)
    expect(screen.queryByText(/not one of yours/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Tenant suspended/)).not.toBeInTheDocument()
  })

  it('refetches the tenant from that retry, and renders it when it returns', async () => {
    let failNext = true
    server.use(
      http.get('/api/v1/tenants', () => ok([{ tenant: TENANT, role: 'owner' }], 'Tenants.')),
      http.get('/api/v1/tenants/acme', () =>
        failNext
          ? fail('Something went wrong', 500)
          : ok(tenantDetail(TENANT, 'owner'), 'Tenant retrieved.')
      ),
      http.get('/api/v1/tenants/acme/members', () => ok([], 'Members retrieved.')),
      http.get('/api/v1/tenants/acme/settings', () => ok(SETTINGS, 'Settings retrieved.'))
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme')

    const alert = await screen.findByRole('alert')
    failNext = false
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Acme Corp' })).toBeInTheDocument()
  })

  it('renders a not-found state for a 404, not the load-error panel', async () => {
    server.use(
      http.get('/api/v1/tenants', () => ok([], 'Tenants retrieved.')),
      http.get('/api/v1/tenants/ghost', () => fail('Tenant not found', 404))
    )
    renderAppAt('/tenants/ghost')

    const heading = await screen.findByRole('heading', { name: 'Tenant not available' })
    expect(heading).toBeInTheDocument()
    // The API answers the same 404 for "no such tenant" and "you are not a member", so the page must not guess between them: "you are not a member of ghost" would confirm ghost exists.
    expect(screen.queryByText(/not a member/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to your tenants' })).toBeInTheDocument()
  })

  it('shows the detail template under the app shell while the tenant loads', async () => {
    mockTenant('owner')
    server.use(http.get('/api/v1/tenants/acme', () => new Promise<Response>(() => {})))
    renderAppAt('/tenants/acme')
    const template = await screen.findByRole('status', { name: 'Loading' })
    expect(template.querySelector('[data-slot="page-heading-skeleton"]')).not.toBeNull()
    expect(template.querySelector('[data-slot="page-tabs-skeleton"]')).not.toBeNull()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1, name: 'Acme Corp' })).not.toBeInTheDocument()
  })

  it('holds the checklist’s place with a skeleton while it loads, with Details already up', async () => {
    mockTenant('owner')
    server.use(http.get('/api/v1/tenants/acme/onboarding', () => new Promise<Response>(() => {})))
    renderAppAt('/tenants/acme')
    expect(await screen.findByRole('heading', { level: 2, name: 'Details' })).toBeVisible()
    const section = document.querySelector('[data-slot="query-state"][aria-busy="true"]')
    expect(section).not.toBeNull()
  })

  it('says the checklist failed, in its own place, and keeps Details', async () => {
    mockTenant('owner')
    server.use(http.get('/api/v1/tenants/acme/onboarding', () => fail('Something went wrong', 500)))
    renderAppAt('/tenants/acme')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Getting started could not be loaded.'
    )
    expect(screen.getByRole('heading', { level: 2, name: 'Details' })).toBeVisible()
  })

  it('shows nothing for an API without the checklist (404)', async () => {
    mockTenant('owner')
    server.use(http.get('/api/v1/tenants/acme/onboarding', () => fail('Not found', 404)))
    renderAppAt('/tenants/acme')
    expect(await screen.findByRole('heading', { level: 2, name: 'Details' })).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders the tenant header, the role badge and only the Overview tab', async () => {
    mockTenant('owner')
    renderAppAt('/tenants/acme')

    expect(await screen.findByRole('heading', { name: 'Acme Corp', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Owner')).toBeInTheDocument()
    const tabs = screen.getByRole('navigation', { name: 'Tenant sections' })
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((link) => link.textContent)
    ).toEqual(['Overview'])
  })

  it('shows the details read-only, with a link to edit them in workspace settings', async () => {
    mockTenant('owner')
    renderAppAt('/tenants/acme')

    expect(await screen.findByRole('heading', { name: 'Details', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('Anvils')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Workspace settings' })).toHaveAttribute(
      'href',
      '/settings/workspace/acme/general'
    )
    // Editing lives in Settings now, even for an owner.
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })

  it('opens the workspace settings as a real route from the details link', async () => {
    mockTenant('owner')
    const user = userEvent.setup()
    const router = renderAppAt('/tenants/acme')

    await user.click(await screen.findByRole('link', { name: 'Workspace settings' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/settings/workspace/acme/general')
    })
    expect(await screen.findByLabelText('Timezone')).toHaveValue('Europe/London')
  })

  it('shows a viewer the details read-only, with no form', async () => {
    mockTenant('viewer')
    renderAppAt('/tenants/acme')

    // Awaited: the details render once the tenant detail arrives.
    expect(await screen.findByText('Anvils')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })

  it('tells staff they are viewing the tenant as platform staff, with a way back', async () => {
    mockTenant('viewer', 'platform')
    renderAppAt('/tenants/acme')

    const text = await screen.findByText(/as platform staff/)
    const banner = text.closest('[role="status"]')
    if (!(banner instanceof HTMLElement)) throw new Error('the banner is not a status region')
    expect(banner).toHaveTextContent('You’re viewing Acme Corp as platform staff (Viewer).')
    expect(within(banner).getByRole('link', { name: 'Back to your tenants' })).toHaveAttribute(
      'href',
      '/tenants'
    )
    // The effective role gates the view, so a staff viewer gets the read-only one.
    expect(await screen.findByText('Anvils')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })

  // Membership wins: a member is never told they are staff here.
  it('shows no staff banner to a member', async () => {
    mockTenant('owner')
    renderAppAt('/tenants/acme')

    await screen.findByText('Anvils')
    expect(screen.queryByText(/as platform staff/)).not.toBeInTheDocument()
  })
})

describe('tenant analytics group', () => {
  /** Removes the route analytics a test installed; replaced on each install. */
  let uninstall: () => void = () => {}

  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
  })

  afterEach(() => {
    uninstall()
  })

  /** Renders the app with the route analytics the real app installs, which the tenant group is set from. */
  function renderWithRouteAnalytics(path: string) {
    const router = renderAppAt(path)
    uninstall = installRouteAnalytics(router)
    return router
  }

  it('groups analytics under the tenant the URL names, from the loader, as a member', async () => {
    const setTenantGroup = vi.spyOn(analytics, 'setTenantGroup')
    mockTenant('owner')
    renderWithRouteAnalytics('/tenants/acme')
    await screen.findByRole('heading', { name: 'Acme Corp', level: 1 })
    await waitFor(() => expect(setTenantGroup).toHaveBeenCalledWith(TENANT_ID, 'member'))
  })

  it('marks staff who reached the tenant through platform access', async () => {
    const setTenantGroup = vi.spyOn(analytics, 'setTenantGroup')
    mockTenant('admin', 'platform')
    renderWithRouteAnalytics('/tenants/acme')
    await screen.findByRole('heading', { name: 'Acme Corp', level: 1 })
    await waitFor(() => expect(setTenantGroup).toHaveBeenCalledWith(TENANT_ID, 'platform'))
  })

  it('groups nothing for a tenant that is not available, and leaves any group', async () => {
    const setTenantGroup = vi.spyOn(analytics, 'setTenantGroup')
    const clearTenantGroup = vi.spyOn(analytics, 'clearTenantGroup')
    server.use(
      http.get('/api/v1/tenants', () => ok([], 'Tenants retrieved.')),
      http.get('/api/v1/tenants/ghost', () => fail('Tenant not found', 404))
    )
    renderWithRouteAnalytics('/tenants/ghost')
    await screen.findByRole('heading', { name: 'Tenant not available' })
    await waitFor(() => expect(clearTenantGroup).toHaveBeenCalled())
    expect(setTenantGroup).not.toHaveBeenCalled()
  })
})
