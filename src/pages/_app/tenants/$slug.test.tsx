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
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

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

function mockTenant(myRole: MembershipRole) {
  server.use(
    http.get('/api/v1/tenants', () => ok([{ tenant: TENANT, role: myRole }], 'Tenants retrieved.')),
    http.get('/api/v1/tenants/acme', () => ok(TENANT, 'Tenant retrieved.')),
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

    // Awaited: the role arrives with the tenant LIST, a beat after the tab
    // itself renders, and until then the tab shows a skeleton rather than
    // guessing read-only.
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
})
