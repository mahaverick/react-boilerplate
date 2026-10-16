import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MembershipRole } from '@/constants/roles'
import { resetSessionForTests } from '@/http/session'
import { toast } from '@/lib/toast'
import { installRouteAnalytics } from '@/observability/route-telemetry'
import * as analytics from '@/observability/telemetry'
import { tenantKeys } from '@/queries/tenant.queries'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { useCurrentTenantStore } from '@/states/current-tenant.store'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { fail, ok, tenantDetail, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { TenantAccess } from '@/types/api.types'

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
    http.get('/api/v1/tenants', () =>
      ok(
        listPage([
          {
            tenant: { ...TENANT, isPlatform: false },
            role: myRole,
            isPlatform: false,
            joinedAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
        'Tenants retrieved.'
      )
    ),
    http.get('/api/v1/tenants/acme', () =>
      ok(tenantDetail(TENANT, myRole, access), 'Tenant retrieved.')
    ),
    http.get('/api/v1/tenants/acme/members', () => ok(listPage([]), 'Members retrieved.')),
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

describe('workspace settings', () => {
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    localStorage.clear()
    useCurrentTenantStore.setState({ remembered: {} })
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
  })

  it('shows the settings template under the settings heading while the tenant loads', async () => {
    mockTenant('owner')
    server.use(http.get('/api/v1/tenants/acme', () => new Promise<Response>(() => {})))
    renderAppAt('/settings/workspace/acme/general')
    const template = await screen.findByRole('status', { name: 'Loading' })
    expect(template.querySelector('[data-slot="page-heading-skeleton"]')).toBeNull()
    expect(template.querySelectorAll('[data-slot="card"]')).toHaveLength(3)
    expect(screen.getByRole('heading', { level: 1, name: 'General' })).toBeVisible()
  })

  it('opens General at the workspace root', async () => {
    mockTenant('owner')
    const router = renderAppAt('/settings/workspace/acme')
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/settings/workspace/acme/general')
    )
    expect(await screen.findByRole('heading', { level: 1, name: 'General' })).toBeInTheDocument()
  })

  it('shows the edit form and no banner to an owner', async () => {
    mockTenant('owner')
    renderAppAt('/settings/workspace/acme/general')
    expect(await screen.findByRole('button', { name: 'Save changes' })).toBeInTheDocument()
    expect(
      screen.queryByText('You can view these settings. Owners and admins can change them.')
    ).toBeNull()
  })

  it('shows a viewer the read-only banner and details', async () => {
    mockTenant('viewer')
    renderAppAt('/settings/workspace/acme/general')
    expect(
      await screen.findByText('You can view these settings. Owners and admins can change them.')
    ).toBeInTheDocument()
    expect(await screen.findByText('Anvils')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
  })

  it.each([
    ['/tenants/acme/members', '/settings/workspace/acme/members'],
    ['/tenants/acme/members/', '/settings/workspace/acme/members'],
    ['/tenants/acme/settings', '/settings/workspace/acme/general'],
    ['/tenants/acme/settings/', '/settings/workspace/acme/general'],
    ['/tenants/acme/activity', '/settings/workspace/acme/activity'],
    ['/tenants/acme/activity/', '/settings/workspace/acme/activity'],
  ])('redirects the old %s to %s', async (from, to) => {
    mockTenant('owner')
    const router = renderAppAt(from)
    await waitFor(() => expect(router.state.location.pathname).toBe(to))
  })

  it.each([
    ['/tenants/acme/members', '/settings/workspace/acme/members'],
    ['/tenants/acme/settings', '/settings/workspace/acme/general'],
    ['/tenants/acme/activity', '/settings/workspace/acme/activity'],
    ['/settings/workspace/acme', '/settings/workspace/acme/general'],
  ])('keeps the query and hash when redirecting %s', async (from, to) => {
    mockTenant('owner')
    const router = renderAppAt(`${from}?x=1#y`)
    await waitFor(() => expect(router.state.location.pathname).toBe(to))
    expect(router.state.location.searchStr).toBe('?x=1')
    expect(router.state.location.hash).toBe('y')
  })

  it('groups analytics under the tenant the URL names, as on the tenant pages', async () => {
    const setTenantGroup = vi.spyOn(analytics, 'setTenantGroup')
    mockTenant('owner')
    const router = renderAppAt('/settings/workspace/acme/members')
    const uninstall = installRouteAnalytics(router)
    try {
      await screen.findByRole('heading', { level: 1, name: 'Members' })
      await waitFor(() => expect(setTenantGroup).toHaveBeenCalledWith(TENANT_ID, 'member'))
    } finally {
      uninstall()
      vi.restoreAllMocks()
    }
  })

  it('leaves the tenant home with only Overview and flagged tabs', async () => {
    mockTenant('owner')
    renderAppAt('/tenants/acme')
    const tabs = await screen.findByRole('navigation', { name: 'Tenant sections' })
    expect(tabs).toHaveTextContent('Overview')
    expect(tabs).not.toHaveTextContent('Members')
    expect(tabs).not.toHaveTextContent('Settings')
    expect(tabs).not.toHaveTextContent('Activity')
  })
})

describe('workspace general settings', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    localStorage.clear()
    useCurrentTenantStore.setState({ remembered: {} })
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
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
    renderAppAt('/settings/workspace/acme/general')

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
    renderAppAt('/settings/workspace/acme/general')

    await user.clear(await screen.findByLabelText('Description'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(patched).not.toBeNull()
    })
    // `null` clears the column; `undefined` would mean "leave it alone" and the deleted description would come back.
    expect(patched).toMatchObject({ description: null })
  })

  it('refuses invalid metadata JSON before it reaches the API', async () => {
    mockTenant('owner')
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/general')

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
    renderAppAt('/settings/workspace/acme/general')

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
    renderAppAt('/settings/workspace/acme/general')

    await user.type(await screen.findByLabelText('Locale'), '-GB')
    await user.click(screen.getByRole('button', { name: 'Save settings' }))

    const message = await screen.findByText('Something broke.')
    expect(message.closest('form')).not.toBeNull()
    expect(screen.getAllByText('Something broke.')).toHaveLength(1)
    expect(toastError).not.toHaveBeenCalled()
  })

  /**
   * Serves stored values the client's rules refuse (a `javascript:` logo, a zero-width space,
   * an unknown timezone, an underscore locale), as data saved under looser rules would be.
   * The forms send only what the user changed, so such a value neither blocks a save of
   * another field nor goes back over the wire.
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
    renderAppAt('/settings/workspace/acme/general')

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
    renderAppAt('/settings/workspace/acme/general')

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
    renderAppAt('/settings/workspace/acme/general')

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
    renderAppAt('/settings/workspace/acme/general')

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
    renderAppAt('/settings/workspace/acme/general')

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
    expect(await screen.findByRole('alert')).toHaveTextContent('Change a field before saving.')
    expect(patched).toBeNull()

    await user.type(timezone, 'X')
    await waitFor(() => {
      expect(screen.queryByText('Change a field before saving.')).not.toBeInTheDocument()
    })
  })

  it('asks for a change, and sends nothing, when Save is pressed with no changes', async () => {
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
    renderAppAt('/settings/workspace/acme/general')

    const name = await screen.findByLabelText('Name')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    // The message is the barrier: it is set where the request would have been sent.
    expect(await screen.findByRole('alert')).toHaveTextContent('Change a field before saving.')
    expect(patches).toBe(0)
    expect(toastSuccess).not.toHaveBeenCalled()

    await user.type(name, ' Ltd')
    await waitFor(() => {
      expect(screen.queryByText('Change a field before saving.')).not.toBeInTheDocument()
    })
  })

  it("does not send another admin's change back after an unchanged Save and a refetch", async () => {
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
    renderAppAt('/settings/workspace/acme/general')

    const name = await screen.findByLabelText('Name')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Change a field before saving.')

    served = { ...TENANT, name: 'Acme Corporation', website: 'https://other.example' }
    await act(() => queryClient.refetchQueries({ queryKey: tenantKeys.detail('acme') }))
    // The layout's tenant line reads the same query, so it shows the refetch once the form has it too.
    await screen.findByText('Acme Corporation')
    await user.clear(name)
    await user.type(name, 'Acme Ltd')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(patched).toEqual({ name: 'Acme Ltd' })
    })
  })

  it('sends the edit again when Save is pressed after a failed save', async () => {
    mockTenant('owner')
    const bodies: unknown[] = []
    server.use(
      http.patch('/api/v1/tenants/acme', async ({ request }) => {
        bodies.push(await request.json())
        return bodies.length === 1
          ? fail('Something broke.', 500)
          : ok({ ...TENANT, name: 'Acme Ltd' }, 'Tenant updated.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/general')

    const name = await screen.findByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Acme Ltd')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText('Something broke.')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(bodies).toEqual([{ name: 'Acme Ltd' }, { name: 'Acme Ltd' }])
    })
  })

  it('sends a field edited back to its old value after a save', async () => {
    const toastSuccess = vi.spyOn(toast, 'success')
    mockTenant('owner')
    const bodies: unknown[] = []
    server.use(
      http.patch('/api/v1/tenants/acme', async ({ request }) => {
        bodies.push(await request.json())
        return ok(TENANT, 'Tenant updated.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/general')

    const name = await screen.findByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Acme Ltd')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('Tenant updated.')
    })
    await user.clear(name)
    await user.type(name, 'Acme Corp')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(bodies).toEqual([{ name: 'Acme Ltd' }, { name: 'Acme Corp' }])
    })
  })

  it('sends the settings edit again when Save is pressed after a failed save', async () => {
    mockTenant('owner')
    const bodies: unknown[] = []
    server.use(
      http.patch('/api/v1/tenants/acme/settings', async ({ request }) => {
        bodies.push(await request.json())
        return bodies.length === 1
          ? fail('Something broke.', 500)
          : ok({ ...SETTINGS, locale: 'en-GB' }, 'Settings updated.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/general')

    await user.type(await screen.findByLabelText('Locale'), '-GB')
    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    await screen.findByText('Something broke.')
    await user.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() => {
      expect(bodies).toEqual([{ locale: 'en-GB' }, { locale: 'en-GB' }])
    })
  })

  // A save the server finds already applied keeps `updatedAt`, so the form is not remounted.
  it('sends a setting edited back to its old value after a save that left the row as it was', async () => {
    const toastSuccess = vi.spyOn(toast, 'success')
    mockTenant('owner')
    const bodies: unknown[] = []
    server.use(
      http.patch('/api/v1/tenants/acme/settings', async ({ request }) => {
        bodies.push(await request.json())
        return ok(SETTINGS, 'Settings updated.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/general')

    const locale = await screen.findByLabelText('Locale')
    await user.type(locale, '-GB')
    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('Settings updated.')
    })
    await user.type(locale, '{Backspace}{Backspace}{Backspace}')
    await user.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() => {
      expect(bodies).toEqual([{ locale: 'en-GB' }, { locale: 'en' }])
    })
  })

  it('shows a refetch on a form nobody has touched, and still asks for a change', async () => {
    mockTenant('owner')
    let served = TENANT
    let patches = 0
    server.use(
      http.get('/api/v1/tenants/acme', () =>
        ok(tenantDetail(served, 'owner'), 'Tenant retrieved.')
      ),
      http.patch('/api/v1/tenants/acme', () => {
        patches += 1
        return ok(served, 'Tenant updated.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/general')

    await screen.findByLabelText('Name')
    served = { ...TENANT, website: 'https://other.example' }
    await act(() => queryClient.refetchQueries({ queryKey: tenantKeys.detail('acme') }))

    await waitFor(() => {
      expect(screen.getByLabelText('Website')).toHaveValue('https://other.example')
    })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Change a field before saving.')
    expect(patches).toBe(0)
  })

  /**
   * The settings twin of the members page's retry test: a settings failure has its own retry,
   * which must reach the settings query and leave the tenant detail alone. The detail is
   * the role's source, and refetching it would risk changing the role mid-retry.
   */
  it('retries the SETTINGS, not the tenant detail, when the settings are what failed', async () => {
    let settingsCalls = 0
    let detailCalls = 0
    server.use(
      http.get('/api/v1/tenants', () =>
        ok(
          listPage([
            {
              tenant: { ...TENANT, isPlatform: false },
              role: 'owner',
              isPlatform: false,
              joinedAt: '2026-01-01T00:00:00.000Z',
            },
          ]),
          'Tenants.'
        )
      ),
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
    renderAppAt('/settings/workspace/acme/general')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not load this tenant’s settings/i)
    expect(screen.queryByText(/could not load your role/i)).not.toBeInTheDocument()

    // Two calls because the queryClient is `retry: 1`.
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

  it('keeps the platform staff banner on the workspace settings pages', async () => {
    mockTenant('admin', 'platform')
    renderAppAt('/settings/workspace/acme/general')

    await screen.findByRole('button', { name: 'Save settings' })
    expect(screen.getByText(/as platform staff \(Admin\)/)).toBeInTheDocument()
  })
})
