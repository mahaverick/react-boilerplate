import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { PLATFORM_TENANT_ID, TENANT_ID, TENANT_ID_2, TENANT_ID_9 } from '@/tests/fixtures/ids'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, tenantDetail, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

function tenantRow(id: string, name: string, slug: string) {
  return {
    id,
    name,
    slug,
    description: null,
    logo: null,
    website: null,
    lifecycleState: 'active',
    isPlatform: false,
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const ACME = tenantRow(TENANT_ID, 'Acme Corp', 'acme')
const PLATFORM = { ...tenantRow(PLATFORM_TENANT_ID, 'Platform', 'platform'), isPlatform: true }

/**
 * Driven through a real RouterProvider: the switcher reads
 * `useParams({ strict: false })` and navigates, neither of which exists
 * outside a router.
 */
function renderShell(path = '/dashboard'): AnyRouter {
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

/** The options only exist once the popup is open. */
async function openSwitcher() {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('combobox', { name: /^Switch tenant/ }))
  await screen.findByRole('dialog', { name: 'Switch tenant' })
  return user
}

function signInAs(platformRole: 'viewer' | null) {
  useAuthStore.setState({
    accessToken: 'access-token',
    user: { ...testUser, platformRole },
    isAuthenticated: true,
    isBootstrapped: true,
  })
}

describe('TenantSwitcher', () => {
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    signInAs(null)
  })

  it('lists each tenant the account belongs to', async () => {
    server.use(
      http.get('/api/v1/tenants', () =>
        ok([{ tenant: ACME, role: 'owner', isPlatform: false }], 'Tenants.')
      )
    )
    renderShell()
    await openSwitcher()

    const mine = await screen.findByRole('group', { name: 'Your tenants' })
    expect(within(mine).getByRole('option', { name: 'Acme Corp' })).toBeInTheDocument()
  })

  /**
   * The platform tenant is a membership like any other, and the list
   * carries it. It is linked from the user menu instead, never switched to
   * as if it were a customer.
   */
  it('leaves the platform tenant out of Your tenants', async () => {
    signInAs('viewer')
    server.use(
      http.get('/api/v1/tenants', () =>
        ok(
          [
            { tenant: ACME, role: 'owner', isPlatform: false },
            { tenant: PLATFORM, role: 'viewer', isPlatform: true },
          ],
          'Tenants.'
        )
      )
    )
    renderShell()
    await openSwitcher()

    await screen.findByRole('option', { name: 'Acme Corp' })
    expect(screen.queryByRole('option', { name: 'Platform' })).not.toBeInTheDocument()
  })

  it('says the account has no tenants when the list really is empty', async () => {
    renderShell()
    await openSwitcher()

    expect(await screen.findByText('No tenants yet')).toBeInTheDocument()
    expect(screen.queryByText('Tenants could not be loaded')).not.toBeInTheDocument()
  })

  it('says the list is still loading when the popup opens mid-flight', async () => {
    server.use(http.get('/api/v1/tenants', async () => delay('infinite')))
    renderShell()
    await openSwitcher()

    expect(await screen.findByText('Loading tenants…')).toBeInTheDocument()
    expect(screen.queryByText('No tenants yet')).not.toBeInTheDocument()
  })

  it('says the list FAILED, not that it is empty, when the query errors', async () => {
    server.use(http.get('/api/v1/tenants', () => fail('Something went wrong', 500)))
    renderShell()
    await openSwitcher()

    expect(await screen.findByText('Tenants could not be loaded')).toBeInTheDocument()
    expect(screen.queryByText('No tenants yet')).not.toBeInTheDocument()
  })

  it('filters Your tenants by what is typed', async () => {
    server.use(
      http.get('/api/v1/tenants', () =>
        ok(
          [
            { tenant: ACME, role: 'owner', isPlatform: false },
            {
              tenant: tenantRow(TENANT_ID_9, 'Umbrella', 'umbrella'),
              role: 'viewer',
              isPlatform: false,
            },
          ],
          'Tenants.'
        )
      )
    )
    renderShell()
    const user = await openSwitcher()
    await screen.findByRole('option', { name: 'Umbrella' })

    await user.type(screen.getByLabelText('Search tenants'), 'umb')

    expect(await screen.findByRole('option', { name: 'Umbrella' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Acme Corp' })).not.toBeInTheDocument()
  })

  it.each([null, 'viewer', 'owner'] as const)(
    'never asks for all tenants (platformRole %s): staff search lives in Apex',
    async (platformRole) => {
      useAuthStore.setState({ user: { ...testUser, platformRole } })
      let platformCalls = 0
      server.use(
        http.get('/api/v1/platform/tenants', () => {
          platformCalls += 1
          return ok({ tenants: [], nextCursor: null }, 'Tenants retrieved.')
        })
      )
      const user = userEvent.setup()
      renderShell()

      await user.click(await screen.findByRole('combobox', { name: /^Switch tenant/ }))
      await user.keyboard('acme')
      await screen.findByRole('dialog', { name: 'Switch tenant' })

      await settle(300, 'absence has no event: the removed search was debounced 250 ms')
      expect(platformCalls).toBe(0)
      expect(screen.queryByRole('group', { name: 'All tenants' })).not.toBeInTheDocument()
      expect(screen.getByLabelText('Search tenants')).toHaveAttribute(
        'placeholder',
        'Search your tenants…'
      )
    }
  )

  it('navigates to the chosen tenant', async () => {
    server.use(
      http.get('/api/v1/tenants', () =>
        ok([{ tenant: ACME, role: 'owner', isPlatform: false }], 'Tenants.')
      ),
      http.get('/api/v1/tenants/acme', () =>
        ok(tenantDetail(ACME, 'owner', 'member'), 'Tenant retrieved.')
      )
    )
    const router = renderShell()
    const user = await openSwitcher()

    await user.click(await screen.findByRole('option', { name: 'Acme Corp' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/tenants/acme')
    })
  })

  // Staff have no list row for a tenant they reached by platform access, so the label comes from the tenant the route has already loaded.
  it('names a tenant opened by platform access in the trigger', async () => {
    server.use(
      http.get('/api/v1/tenants/globex', () =>
        ok(
          tenantDetail(tenantRow(TENANT_ID_2, 'Globex', 'globex'), 'viewer', 'platform'),
          'Tenant retrieved.'
        )
      )
    )
    renderShell('/tenants/globex')

    expect(
      await screen.findByRole('combobox', { name: 'Switch tenant. Current: Globex' })
    ).toBeInTheDocument()
  })
})
