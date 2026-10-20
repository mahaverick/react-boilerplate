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
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { PLATFORM_TENANT_ID, TENANT_ID, TENANT_ID_2, TENANT_ID_9 } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, tenantDetail, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/** A tenant row as `GET /tenants` and `GET /tenants/:slug` carry it, active and with no optional fields set. */
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
const BETA = tenantRow(TENANT_ID_2, 'Beta Inc', 'beta')
const PLATFORM = { ...tenantRow(PLATFORM_TENANT_ID, 'Platform', 'platform'), isPlatform: true }

/**
 * Mounts the real route tree at `path` and returns the router: the switcher reads
 * `useParams({ strict: false })` and navigates, neither of which works outside a router.
 */
function renderShell(path = '/dashboard'): AnyRouter {
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

/** Opens the switcher and waits for its popup, since the options exist only while it is open. */
async function openSwitcher() {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('combobox', { name: /^Switch tenant/ }))
  await screen.findByRole('dialog', { name: 'Switch tenant' })
  return user
}

/** Signs in as `testUser` with the given staff role, `null` for an ordinary user. */
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
        ok(
          listPage([
            {
              tenant: ACME,
              role: 'owner',
              isPlatform: false,
              joinedAt: '2026-01-01T00:00:00.000Z',
            },
          ]),
          'Tenants.'
        )
      )
    )
    renderShell()
    await openSwitcher()

    const mine = await screen.findByRole('group', { name: 'Your tenants' })
    expect(within(mine).getByRole('option', { name: 'Acme Corp' })).toBeInTheDocument()
  })

  it('lists a suspended tenant as a disabled option marked Suspended', async () => {
    server.use(
      http.get('/api/v1/tenants', () =>
        ok(
          listPage([
            {
              tenant: { ...ACME, lifecycleState: 'suspended' },
              role: 'owner',
              isPlatform: false,
              joinedAt: '2026-01-01T00:00:00.000Z',
            },
          ]),
          'Tenants.'
        )
      )
    )
    renderShell()
    await openSwitcher()
    const option = await screen.findByRole('option', { name: /Acme Corp/ })
    expect(option).toHaveAttribute('aria-disabled', 'true')
    expect(option).toHaveTextContent('Suspended')
  })

  it('does not navigate when Enter is pressed on a suspended option', async () => {
    server.use(
      http.get('/api/v1/tenants', () =>
        ok(
          listPage([
            {
              tenant: { ...ACME, lifecycleState: 'suspended' },
              role: 'owner',
              isPlatform: false,
              joinedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              tenant: BETA,
              role: 'owner',
              isPlatform: false,
              joinedAt: '2026-01-01T00:00:00.000Z',
            },
          ]),
          'Tenants.'
        )
      )
    )
    const router = renderShell()
    const user = await openSwitcher()
    await screen.findByRole('option', { name: /Acme Corp/ })

    await user.keyboard('{ArrowDown}{Enter}')

    expect(router.state.location.pathname).toBe('/dashboard')
    expect(screen.getByRole('option', { name: /Acme Corp/ })).toBeInTheDocument()
  })

  /** The list carries the platform tenant like any membership, but it is linked from the user menu instead and never switched to as a customer. */
  it('leaves the platform tenant out of Your tenants', async () => {
    signInAs('viewer')
    server.use(
      http.get('/api/v1/tenants', () =>
        ok(
          listPage([
            {
              tenant: ACME,
              role: 'owner',
              isPlatform: false,
              joinedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              tenant: PLATFORM,
              role: 'viewer',
              isPlatform: true,
              joinedAt: '2026-01-01T00:00:00.000Z',
            },
          ]),
          'Tenants.'
        )
      )
    )
    renderShell()
    await openSwitcher()

    await screen.findByRole('option', { name: 'Acme Corp' })
    expect(screen.queryByRole('option', { name: 'Platform' })).not.toBeInTheDocument()
  })

  it('says No tenants yet, with no All tenants group, for staff whose only membership is the platform tenant', async () => {
    signInAs('viewer')
    server.use(
      http.get('/api/v1/tenants', () =>
        ok(
          listPage([
            {
              tenant: PLATFORM,
              role: 'viewer',
              isPlatform: true,
              joinedAt: '2026-01-01T00:00:00.000Z',
            },
          ]),
          'Tenants.'
        )
      )
    )
    renderShell()
    await openSwitcher()

    expect(await screen.findByText('No tenants yet')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'All tenants' })).not.toBeInTheDocument()
  })

  it('says the account has no tenants when the list really is empty', async () => {
    renderShell()
    await openSwitcher()

    expect(await screen.findByText('No tenants yet')).toBeInTheDocument()
    expect(screen.queryByText('Tenants didn’t load')).not.toBeInTheDocument()
  })

  it('says the list is still loading when the popup opens mid-flight', async () => {
    // On a tenant page the shell renders without the list: only a page without $slug waits for it, to resolve ?tenant.
    server.use(
      http.get('/api/v1/tenants', async () => delay('infinite')),
      http.get('/api/v1/tenants/acme', () => ok(tenantDetail(ACME, 'owner'), 'Tenant retrieved.'))
    )
    renderShell('/tenants/acme')
    await openSwitcher()

    expect(await screen.findByText('Loading tenants…')).toBeInTheDocument()
    expect(screen.queryByText('No tenants yet')).not.toBeInTheDocument()
  })

  it('says the list FAILED, not that it is empty, when the query errors', async () => {
    server.use(http.get('/api/v1/tenants', () => fail('Something went wrong', 500)))
    renderShell()
    await openSwitcher()

    const popup = screen.getByRole('dialog', { name: 'Switch tenant' })
    expect(await within(popup).findByText('Tenants didn’t load')).toBeInTheDocument()
    expect(screen.queryByText('No tenants yet')).not.toBeInTheDocument()
  })

  it('names the list as loading on the trigger while it is in flight', async () => {
    server.use(http.get('/api/v1/tenants', async () => delay('infinite')))
    renderShell('/dashboard')
    expect(
      await screen.findByRole('combobox', { name: 'Switch tenant. Current: Loading tenants…' })
    ).toBeVisible()
  })

  it('names the failure on the trigger, and Try again reads the list again', async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/tenants', () => {
        calls += 1
        return calls <= 2
          ? fail('Something went wrong', 500)
          : ok(
              listPage([
                {
                  tenant: ACME,
                  role: 'owner',
                  isPlatform: false,
                  joinedAt: '2026-01-01T00:00:00.000Z',
                },
              ]),
              'Tenants retrieved.'
            )
      })
    )
    renderShell()
    // The queryClient is `retry: 1`: the failure lands after the second attempt.
    expect(
      await screen.findByRole('combobox', {
        name: 'Switch tenant. Current: Tenants didn’t load',
      })
    ).toBeVisible()
    const user = await openSwitcher()
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    const popup = screen.getByRole('dialog', { name: 'Switch tenant' })
    expect(await within(popup).findByText('Acme Corp')).toBeInTheDocument()
  })

  it('filters Your tenants by what is typed', async () => {
    server.use(
      http.get('/api/v1/tenants', () =>
        ok(
          listPage([
            {
              tenant: ACME,
              role: 'owner',
              isPlatform: false,
              joinedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              tenant: tenantRow(TENANT_ID_9, 'Umbrella', 'umbrella'),
              role: 'viewer',
              isPlatform: false,
            },
          ]),
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

  it('navigates from a tenant page to the chosen tenant', async () => {
    server.use(
      http.get('/api/v1/tenants', () =>
        ok(
          listPage([
            {
              tenant: ACME,
              role: 'owner',
              isPlatform: false,
              joinedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              tenant: BETA,
              role: 'owner',
              isPlatform: false,
              joinedAt: '2026-01-01T00:00:00.000Z',
            },
          ]),
          'Tenants.'
        )
      ),
      http.get('/api/v1/tenants/acme', () =>
        ok(tenantDetail(ACME, 'owner', 'member'), 'Tenant retrieved.')
      ),
      http.get('/api/v1/tenants/beta', () => ok(tenantDetail(BETA, 'owner'), 'Tenant retrieved.'))
    )
    const router = renderShell('/tenants/beta')
    const user = await openSwitcher()

    await user.click(await screen.findByRole('option', { name: 'Acme Corp' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/tenants/acme')
    })
  })

  it('keeps the workspace section when switching tenant', async () => {
    server.use(
      http.get('/api/v1/tenants', () =>
        ok(
          listPage([
            {
              tenant: ACME,
              role: 'owner',
              isPlatform: false,
              joinedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              tenant: BETA,
              role: 'owner',
              isPlatform: false,
              joinedAt: '2026-01-01T00:00:00.000Z',
            },
          ]),
          'Tenants.'
        )
      ),
      http.get('/api/v1/tenants/acme', () => ok(tenantDetail(ACME, 'owner'), 'Tenant retrieved.')),
      http.get('/api/v1/tenants/beta', () => ok(tenantDetail(BETA, 'owner'), 'Tenant retrieved.'))
    )
    const router = renderShell('/settings/workspace/acme/members')
    const user = await openSwitcher()
    await user.click(await screen.findByRole('option', { name: 'Beta Inc' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/settings/workspace/beta/members')
    )
  })

  it('links the tenants page, where a tenant is created, and closes on the way', async () => {
    server.use(
      http.get('/api/v1/tenants', () =>
        ok(
          listPage([
            {
              tenant: ACME,
              role: 'owner',
              isPlatform: false,
              joinedAt: '2026-01-01T00:00:00.000Z',
            },
          ]),
          'Tenants.'
        )
      )
    )
    const router = renderShell()
    const user = await openSwitcher()

    await user.click(screen.getByRole('link', { name: 'Create a tenant' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/tenants')
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Switch tenant' })).not.toBeInTheDocument()
    })
  })

  it('reaches the create-tenant link from the search box by keyboard', async () => {
    server.use(
      http.get('/api/v1/tenants', () =>
        ok(
          listPage([
            {
              tenant: ACME,
              role: 'owner',
              isPlatform: false,
              joinedAt: '2026-01-01T00:00:00.000Z',
            },
          ]),
          'Tenants.'
        )
      )
    )
    const router = renderShell()
    const user = await openSwitcher()
    await screen.findByRole('option', { name: 'Acme Corp' })

    await user.click(screen.getByLabelText('Search tenants'))
    await user.tab()
    expect(screen.getByRole('link', { name: 'Create a tenant' })).toHaveFocus()
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/tenants')
    })
  })

  // The vendored ComboboxTrigger appends its own chevron, which doubled the selector icon.
  it('draws one selector icon in the trigger, beside the tenant mark', async () => {
    renderShell()

    const trigger = await screen.findByRole('combobox', { name: /^Switch tenant/ })
    expect(trigger.querySelectorAll('svg')).toHaveLength(2)
  })

  it('asks to choose a tenant, with no Tenant caption, when none is open', async () => {
    renderShell()

    const trigger = await screen.findByRole('combobox', {
      name: 'Switch tenant. Current: Choose a tenant',
    })
    expect(trigger).toHaveTextContent(/^Choose a tenant$/)
  })

  it('captions an open tenant as Tenant', async () => {
    server.use(
      http.get('/api/v1/tenants', () =>
        ok(
          listPage([
            {
              tenant: ACME,
              role: 'owner',
              isPlatform: false,
              joinedAt: '2026-01-01T00:00:00.000Z',
            },
          ]),
          'Tenants.'
        )
      )
    )
    renderShell('/tenants/acme')

    const trigger = await screen.findByRole('combobox', {
      name: 'Switch tenant. Current: Acme Corp',
    })
    expect(trigger).toHaveTextContent(/^Acme CorpTenant$/)
  })

  // Staff have no list row for a tenant reached by platform access, so the label comes from the tenant the route already loaded.
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
