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
import { beforeEach, describe, expect, it } from 'vitest'
import type { MembershipRole } from '@/constants/roles'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, tenantDetail, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { TenantAccess } from '@/types/api.types'

const TENANT = {
  id: 't1',
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
  tenantId: 't1',
  timezone: 'Europe/London',
  locale: 'en',
  metadata: { tier: 'pro' },
  updatedAt: '2026-01-01T00:00:00.000Z',
}

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

function renderAppAt(path: string): AnyRouter {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
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

  // `tenantQueryOptions` says a 404 becomes `null` and that "every OTHER
  // failure still rejects and still reaches the boundary". No boundary was
  // configured, so a 500 reached TanStack's bare default instead: the raw
  // error text, no retry, none of the app's chrome.
  it('renders the route error boundary, with a retry, for a non-404 failure', async () => {
    server.use(
      http.get('/api/v1/tenants', () => ok([], 'Tenants retrieved.')),
      http.get('/api/v1/tenants/acme', () => fail('Something went wrong', 500))
    )
    renderAppAt('/tenants/acme')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not load this tenant/i)
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    // Not the 404 panel: the tenant may be perfectly fine and unreachable.
    expect(screen.queryByText(/Tenant not available/i)).not.toBeInTheDocument()
  })

  it('re-runs the loader from that retry, and renders the tenant when it returns', async () => {
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

  it('renders a not-found state for a 404, not an error boundary', async () => {
    server.use(
      http.get('/api/v1/tenants', () => ok([], 'Tenants retrieved.')),
      http.get('/api/v1/tenants/ghost', () => fail('Tenant not found', 404))
    )
    renderAppAt('/tenants/ghost')

    const heading = await screen.findByRole('heading', { name: 'Tenant not available' })
    expect(heading).toBeInTheDocument()
    // Ruling G: the API answers the SAME 404 for "no such tenant" and "you
    // are not a member", and this page must not guess between them — saying
    // "you are not a member of ghost" would confirm that ghost exists.
    expect(screen.queryByText(/not a member/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to your tenants' })).toBeInTheDocument()
  })

  it('renders the tenant header, the role badge and the tab links', async () => {
    mockTenant('owner')
    renderAppAt('/tenants/acme')

    expect(await screen.findByRole('heading', { name: 'Acme Corp', level: 1 })).toBeInTheDocument()
    const tabs = screen.getByRole('navigation', { name: 'Tenant sections' })
    for (const label of ['Overview', 'Members', 'Settings']) {
      expect(within(tabs).getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('navigates between tabs as real routes', async () => {
    mockTenant('owner')
    const user = userEvent.setup()
    const router = renderAppAt('/tenants/acme')
    await screen.findByRole('heading', { name: 'Overview' })

    await user.click(screen.getByRole('link', { name: 'Settings' }))
    await waitFor(() => {
      // A URL, not a panel: reloading here lands back on Settings.
      expect(router.state.location.pathname).toBe('/tenants/acme/settings')
    })
    expect(await screen.findByLabelText('Timezone')).toHaveValue('Europe/London')
  })

  it('shows a viewer the details read-only, with no form', async () => {
    mockTenant('viewer')
    renderAppAt('/tenants/acme')

    // Awaited: the role arrives with the tenant detail, and until then
    // the tab shows a skeleton rather than guessing read-only.
    expect(await screen.findByText('Anvils')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })

  it('lets an owner edit the tenant, and never offers the slug', async () => {
    mockTenant('owner')
    let patched: unknown = null
    server.use(
      http.patch('/api/v1/tenants/acme', async ({ request }) => {
        patched = await request.json()
        return ok({ ...TENANT, name: 'Acme Ltd' }, 'Tenant updated.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme')

    const name = await screen.findByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Acme Ltd')
    // `slug` is absent from updateTenantSchema: the API refuses to rename.
    expect(screen.queryByLabelText('Slug')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => {
      expect(patched).toMatchObject({ name: 'Acme Ltd' })
    })
    expect(patched).not.toHaveProperty('slug')
  })

  it('sends null for a cleared description rather than leaving it in place', async () => {
    mockTenant('owner')
    let patched: Record<string, unknown> | null = null
    server.use(
      http.patch('/api/v1/tenants/acme', async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>
        return ok({ ...TENANT, description: null }, 'Tenant updated.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme')

    await user.clear(await screen.findByLabelText('Description'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(patched).not.toBeNull()
    })
    // `null` CLEARS the column. `undefined` would mean "leave it alone" and
    // the description the user just deleted would come straight back.
    expect(patched).toMatchObject({ description: null })
  })

  it('refuses invalid metadata JSON before it reaches the API', async () => {
    mockTenant('owner')
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/settings')

    const metadata = await screen.findByLabelText('Metadata')
    await user.clear(metadata)
    await user.type(metadata, '{{oops')
    await user.click(screen.getByRole('button', { name: 'Save settings' }))

    expect(await screen.findByText('Metadata must be valid JSON.')).toBeInTheDocument()
  })

  /**
   * The settings twin of the members-tab retry test. A settings failure has
   * its own retry, which must reach the SETTINGS query and leave the tenant
   * detail alone. The detail is the role's source, and refetching it instead
   * was the defect the members-tab test was written for.
   */
  it('retries the SETTINGS, not the tenant detail, when the settings are what failed', async () => {
    let settingsCalls = 0
    let detailCalls = 0
    server.use(
      http.get('/api/v1/tenants', () => ok([{ tenant: TENANT, role: 'owner' }], 'Tenants.')),
      http.get('/api/v1/tenants/acme', () => {
        detailCalls += 1
        return ok(tenantDetail(TENANT, 'owner'), 'Tenant retrieved.')
      }),
      http.get('/api/v1/tenants/acme/settings', () => {
        settingsCalls += 1
        return fail('Something went wrong.', 500)
      })
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/settings')

    const alert = await screen.findByRole('alert', {}, { timeout: 5000 })
    expect(alert).toHaveTextContent(/could not load this tenant’s settings/i)
    expect(screen.queryByText(/could not load your role/i)).not.toBeInTheDocument()

    // Two: the queryClient is `retry: 1`.
    await waitFor(() => {
      expect(settingsCalls).toBe(2)
    })
    const settingsBefore = settingsCalls
    const detailBefore = detailCalls

    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    await waitFor(() => {
      expect(settingsCalls).toBeGreaterThan(settingsBefore)
    })
    expect(detailCalls).toBe(detailBefore)
  })
})
