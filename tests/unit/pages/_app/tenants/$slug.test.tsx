import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError } from 'axios'
import { http } from 'msw'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MembershipRole } from '@/constants/roles'
import { resetSessionForTests } from '@/http/session'
import * as analytics from '@/observability/analytics'
import { noteError } from '@/observability/errors'
import { installRouteAnalytics } from '@/observability/route-analytics'
import { tenantKeys } from '@/queries/tenant.queries'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, tenantDetail, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { TenantAccess } from '@/types/api.types'

vi.mock('@/observability/errors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/observability/errors')>()),
  noteError: vi.fn(),
}))

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

  /**
   * `tenantQueryOptions` says a 404 becomes `null` and that every OTHER
   * failure still rejects and still reaches the boundary. Without a
   * configured boundary, a 500 would reach TanStack's bare default
   * instead: the raw error text, no retry, none of the app's chrome.
   */
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

  it('hands the load failure to error tracking as handled, from the router', async () => {
    vi.mocked(noteError).mockClear()
    server.use(
      http.get('/api/v1/tenants', () => ok([], 'Tenants retrieved.')),
      http.get('/api/v1/tenants/acme', () => fail('Something went wrong', 500))
    )
    renderAppAt('/tenants/acme')

    await screen.findByRole('alert')
    expect(noteError).toHaveBeenCalledWith(expect.any(AxiosError), 'router', true)
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
    // The API answers the SAME 404 for "no such tenant" and "you are not a member", and this page must not guess between them — saying "you are not a member of ghost" would confirm that ghost exists.
    expect(screen.queryByText(/not a member/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to your tenants' })).toBeInTheDocument()
  })

  it('renders the tenant header, the role badge and the tab links', async () => {
    mockTenant('owner')
    renderAppAt('/tenants/acme')

    expect(await screen.findByRole('heading', { name: 'Acme Corp', level: 1 })).toBeInTheDocument()
    const tabs = screen.getByRole('navigation', { name: 'Tenant sections' })
    for (const label of ['Overview', 'Members', 'Settings', 'Activity']) {
      expect(within(tabs).getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('offers the Activity tab to owners and admins only', async () => {
    mockTenant('editor')
    renderAppAt('/tenants/acme')

    const tabs = await screen.findByRole('navigation', { name: 'Tenant sections' })
    expect(within(tabs).getByRole('link', { name: 'Settings' })).toBeInTheDocument()
    expect(within(tabs).queryByRole('link', { name: 'Activity' })).not.toBeInTheDocument()
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

    // Awaited: the role arrives with the tenant detail, and until then the tab shows a skeleton rather than guessing read-only.
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
    // `null` CLEARS the column. `undefined` would mean "leave it alone" and the description the user just deleted would come straight back.
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

  it('shows a refused tenant edit once, in the form, with no toast', async () => {
    const toastError = vi.spyOn(toast, 'error')
    mockTenant('owner')
    server.use(http.patch('/api/v1/tenants/acme', () => fail('Something broke.', 500)))
    const user = userEvent.setup()
    renderAppAt('/tenants/acme')

    await user.type(await screen.findByLabelText('Name'), ' Ltd')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    const message = await screen.findByText('Something broke.')
    expect(message.closest('form')).not.toBeNull()
    expect(screen.getAllByText('Something broke.')).toHaveLength(1)
    expect(toastError).not.toHaveBeenCalled()
  })

  it('shows a refused settings save once, in the form, with no toast', async () => {
    const toastError = vi.spyOn(toast, 'error')
    mockTenant('owner')
    server.use(http.patch('/api/v1/tenants/acme/settings', () => fail('Something broke.', 500)))
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/settings')

    await user.type(await screen.findByLabelText('Locale'), '-GB')
    await user.click(screen.getByRole('button', { name: 'Save settings' }))

    const message = await screen.findByText('Something broke.')
    expect(message.closest('form')).not.toBeNull()
    expect(screen.getAllByText('Something broke.')).toHaveLength(1)
    expect(toastError).not.toHaveBeenCalled()
  })

  /**
   * Stored values the client's rules now refuse, saved before those rules
   * existed: the forms send only what the user changed, so the old value
   * neither blocks a save of another field nor goes back over the wire.
   */
  function mockLegacyTenant() {
    mockTenant('owner')
    const legacy = { ...TENANT, logo: 'javascript:alert(1)', description: 'Ad\u{200B}min anvils' }
    const legacySettings = { ...SETTINGS, timezone: 'Mars/Olympus_Mons', locale: 'en_GB' }
    server.use(
      http.get('/api/v1/tenants/acme', () =>
        ok(tenantDetail(legacy, 'owner'), 'Tenant retrieved.')
      ),
      http.get('/api/v1/tenants/acme/settings', () => ok(legacySettings, 'Settings retrieved.'))
    )
  }

  it('saves an edited name while a refused legacy logo and description stay as they are', async () => {
    mockLegacyTenant()
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
    await waitFor(() => {
      expect(screen.getByLabelText('Logo URL')).toHaveValue('javascript:alert(1)')
    })
    await user.clear(name)
    await user.type(name, 'Acme Ltd')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(patched).toEqual({ name: 'Acme Ltd' })
    })
    expect(screen.queryByText('Logo must be an http or https URL.')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Logo URL')).toHaveAttribute('aria-invalid', 'false')
  })

  it("sends only the user's edit after a refetch brings another admin's change", async () => {
    mockTenant('owner')
    let served = TENANT
    let patched: unknown = null
    server.use(
      http.get('/api/v1/tenants/acme', () =>
        ok(tenantDetail(served, 'owner'), 'Tenant retrieved.')
      ),
      http.patch('/api/v1/tenants/acme', async ({ request }) => {
        patched = await request.json()
        return ok({ ...served, name: 'Acme Ltd' }, 'Tenant updated.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme')

    const name = await screen.findByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Acme Ltd')
    served = { ...TENANT, website: 'https://other.example', description: 'Ad\u{200B}min' }
    await act(() => queryClient.refetchQueries({ queryKey: tenantKeys.detail('acme') }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(patched).toEqual({ name: 'Acme Ltd' })
    })
  })

  it('shows a legacy logo as invalid once the user edits it, and sends nothing', async () => {
    mockLegacyTenant()
    let patches = 0
    server.use(
      http.patch('/api/v1/tenants/acme', () => {
        patches += 1
        return ok(TENANT, 'Tenant updated.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme')

    const logo = await screen.findByLabelText('Logo URL')
    await waitFor(() => {
      expect(logo).toHaveValue('javascript:alert(1)')
    })
    await user.type(logo, '2')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Logo must be an http or https URL.')).toBeInTheDocument()
    expect(screen.getByLabelText('Logo URL')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText('Description contains characters that are not allowed')).toBeNull()
    // The message is the barrier: a refused submit never reaches onSubmit.
    expect(patches).toBe(0)
  })

  it('saves an edited metadata while a refused legacy timezone and locale stay as they are', async () => {
    mockLegacyTenant()
    let patched: unknown = null
    server.use(
      http.patch('/api/v1/tenants/acme/settings', async ({ request }) => {
        patched = await request.json()
        return ok({ ...SETTINGS, metadata: { tier: 'max' } }, 'Settings updated.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/settings')

    const metadata = await screen.findByLabelText('Metadata')
    expect(screen.getByLabelText('Timezone')).toHaveValue('Mars/Olympus_Mons')
    await user.clear(metadata)
    await user.type(metadata, '{{"tier":"max"}')
    await user.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() => {
      expect(patched).toEqual({ metadata: { tier: 'max' } })
    })
    expect(screen.queryByText(/must be a time zone name/)).not.toBeInTheDocument()
    expect(screen.queryByText(/must be a language tag/)).not.toBeInTheDocument()
  })

  it('shows a legacy timezone as invalid once edited, and not after the edit is undone', async () => {
    mockLegacyTenant()
    let patched: unknown = null
    server.use(
      http.patch('/api/v1/tenants/acme/settings', async ({ request }) => {
        patched = await request.json()
        return ok(SETTINGS, 'Settings updated.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/settings')

    const timezone = await screen.findByLabelText('Timezone')
    await user.type(timezone, 'X')
    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    expect(
      await screen.findByText('Timezone must be a time zone name such as Europe/Paris.')
    ).toBeInTheDocument()
    expect(patched).toBeNull()

    await user.type(timezone, '{Backspace}')
    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => {
      expect(
        screen.queryByText('Timezone must be a time zone name such as Europe/Paris.')
      ).not.toBeInTheDocument()
    })
    await settle(200, 'absence has no event: a skipped save sends nothing to wait on')
    expect(patched).toBeNull()
  })

  it('sends nothing and says nothing when Save is pressed with no changes', async () => {
    const toastSuccess = vi.spyOn(toast, 'success')
    mockTenant('owner')
    let patches = 0
    server.use(
      http.patch('/api/v1/tenants/acme', () => {
        patches += 1
        return ok(TENANT, 'Tenant updated.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme')

    await screen.findByLabelText('Name')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await settle(200, 'absence has no event: a skipped save sends nothing to wait on')
    expect(patches).toBe(0)
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  /**
   * The settings twin of the members-tab retry test: a settings failure
   * has its own retry, which must reach the SETTINGS query and leave the
   * tenant detail alone. The detail is the role's source, and refetching
   * it instead would risk silently changing the role mid-retry.
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

    const alert = await screen.findByRole('alert')
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
    // The effective role is what gates: a staff viewer gets the read-only view.
    expect(await screen.findByText('Anvils')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })

  // Membership wins, and a member is never told they are "staff" here.
  it('shows no staff banner to a member', async () => {
    mockTenant('owner')
    renderAppAt('/tenants/acme')

    await screen.findByRole('button', { name: 'Save changes' })
    expect(screen.queryByText(/as platform staff/)).not.toBeInTheDocument()
  })

  it('keeps the banner on every tab, not only the overview', async () => {
    mockTenant('admin', 'platform')
    renderAppAt('/tenants/acme/settings')

    await screen.findByRole('button', { name: 'Save settings' })
    expect(screen.getByText(/as platform staff \(Admin\)/)).toBeInTheDocument()
  })
})

describe('tenant analytics group', () => {
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

  /** The app's tree with the router-driven analytics the app installs on its own router. */
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
