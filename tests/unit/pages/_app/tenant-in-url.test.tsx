import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
  type RouterHistory,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { installCurrentTenant } from '@/lib/current-tenant'
import { installRouteAnalytics } from '@/observability/route-telemetry'
import * as analytics from '@/observability/telemetry'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { readRememberedTenant, useCurrentTenantStore } from '@/states/current-tenant.store'
import {
  PLATFORM_TENANT_ID,
  TENANT_ID,
  TENANT_ID_2,
  TENANT_ID_9,
  USER_ID_2,
} from '@/tests/fixtures/ids'
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
const UMBRELLA = tenantRow(TENANT_ID_9, 'Umbrella', 'umbrella', 'suspended')
const PLATFORM = { ...tenantRow(PLATFORM_TENANT_ID, 'Platform', 'platform'), isPlatform: true }

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

/**
 * Mounts the real route tree at `path`, with the current-tenant hook the app's router
 * installs, and counts each location the router starts loading.
 */
function renderAt(path: string): { router: AnyRouter; history: RouterHistory; loads: string[] } {
  const history = createMemoryHistory({ initialEntries: [path] })
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history,
    ...ROUTER_DEFAULTS,
  }) as unknown as AnyRouter
  uninstall = installCurrentTenant(router)
  const loads: string[] = []
  router.subscribe('onBeforeLoad', ({ toLocation }) => {
    loads.push(toLocation.href)
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return { router, history, loads }
}

/** The switcher's trigger, once it names `label` as the current tenant. */
function findSwitcher(label: string) {
  return screen.findByRole('combobox', { name: `Switch tenant. Current: ${label}` })
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

describe('?tenant on pages without $slug', () => {
  it('fills a missing ?tenant from the remembered tenant, replacing the entry', async () => {
    serveTenants([ACME, GLOBEX])
    useCurrentTenantStore.getState().remember(testUser.id, 'globex')
    const { router, history } = renderAt('/dashboard')

    await expectHref(router, '/dashboard?tenant=globex')
    expect(await findSwitcher('Globex')).toBeInTheDocument()
    expect(history.length).toBe(1)
  })

  it('falls back to the first eligible tenant in list order, and remembers it', async () => {
    serveTenants([PLATFORM, UMBRELLA, GLOBEX, ACME])
    const { router } = renderAt('/settings/account/profile')

    await expectHref(router, '/settings/account/profile?tenant=globex')
    expect(await findSwitcher('Globex')).toBeInTheDocument()
    expect(readRememberedTenant(testUser.id)).toBe('globex')
  })

  it('keeps the other search params when it fills ?tenant', async () => {
    serveTenants([ACME])
    const { router } = renderAt('/notifications?foo=bar')

    await waitFor(() =>
      expect(router.state.location.search).toEqual({ foo: 'bar', tenant: 'acme' })
    )
  })

  it('keeps an eligible ?tenant without redirecting, and remembers it', async () => {
    serveTenants([ACME, GLOBEX])
    useCurrentTenantStore.getState().remember(testUser.id, 'acme')
    const { router, loads } = renderAt('/dashboard?tenant=globex')

    expect(await findSwitcher('Globex')).toBeInTheDocument()
    await expectHref(router, '/dashboard?tenant=globex')
    expect(loads).toEqual(['/dashboard?tenant=globex'])
    expect(readRememberedTenant(testUser.id)).toBe('globex')
  })

  it.each([
    ['a tenant the user is not a member of', 'initech'],
    ['a suspended tenant', 'umbrella'],
    ['the platform tenant', 'platform'],
    ['a value that is not a slug', 'Not A Slug'],
    // The router JSON-parses these, so `?tenant` arrives as a number, null or a boolean.
    ['a number', '12345'],
    ['null', 'null'],
    ['true', 'true'],
  ])('replaces %s with the fallback and never shows it as current', async (_label, tenant) => {
    serveTenants([PLATFORM, UMBRELLA, ACME])
    const { router, loads } = renderAt(
      `/settings/account/profile?tenant=${encodeURIComponent(tenant)}`
    )
    const labels: string[] = []
    const observer = new MutationObserver(() => {
      const trigger = document.querySelector('[aria-label^="Switch tenant. Current:"]')
      if (trigger) labels.push(trigger.getAttribute('aria-label') ?? '')
    })
    observer.observe(document.body, { subtree: true, childList: true, attributes: true })

    try {
      await expectHref(router, '/settings/account/profile?tenant=acme')
      expect(await findSwitcher('Acme Corp')).toBeInTheDocument()
      expect(labels.some((label) => /Umbrella|Platform|initech/i.test(label))).toBe(false)
      expect(readRememberedTenant(testUser.id)).toBe('acme')
      // One correcting redirect, then it stops.
      expect(loads).toHaveLength(2)
    } finally {
      observer.disconnect()
    }
  })

  it('replaces the previous user’s ?tenant with one from the new user’s own list', async () => {
    useCurrentTenantStore.getState().remember(testUser.id, 'acme')
    const other = { ...testUser, id: USER_ID_2, email: 'cleo@example.com' }
    signIn(other)
    serveTenants([GLOBEX])
    const { router } = renderAt('/dashboard?tenant=acme')

    await expectHref(router, '/dashboard?tenant=globex')
    expect(await findSwitcher('Globex')).toBeInTheDocument()
    expect(readRememberedTenant(other.id)).toBe('globex')
    expect(readRememberedTenant(testUser.id)).toBe('acme')
  })

  it('never falls back to the previous user’s remembered tenant', async () => {
    useCurrentTenantStore.getState().remember(testUser.id, 'globex')
    const other = { ...testUser, id: USER_ID_2, email: 'cleo@example.com' }
    signIn(other)
    serveTenants([ACME, GLOBEX])
    const first = renderAt('/dashboard')

    // The first eligible tenant in the new user's list, not the globex remembered for the previous user.
    await expectHref(first.router, '/dashboard?tenant=acme')
    expect(await findSwitcher('Acme Corp')).toBeInTheDocument()
    cleanup()
    uninstall?.()

    useCurrentTenantStore.getState().remember(other.id, 'globex')
    const second = renderAt('/dashboard')

    await expectHref(second.router, '/dashboard?tenant=globex')
    expect(await findSwitcher('Globex')).toBeInTheDocument()
  })

  it('validates the ?tenant of a login redirect after sign-in', async () => {
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
    server.use(
      http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)),
      http.post('/api/v1/auth/login', () =>
        ok({ accessToken: 'access-token', user: testUser }, 'Signed in.')
      )
    )
    serveTenants([GLOBEX])
    const { router } = renderAt(
      `/login?redirect=${encodeURIComponent('/settings/account/profile?tenant=acme')}`
    )
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Email'), 'test@example.com')
    await user.type(screen.getByLabelText('Password'), 'Password1!')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await expectHref(router, '/settings/account/profile?tenant=globex')
    expect(await findSwitcher('Globex')).toBeInTheDocument()
  })

  it('leaves out ?tenant, without a redirect loop, for a user with no eligible tenant', async () => {
    serveTenants([PLATFORM, UMBRELLA])
    const { router, loads } = renderAt('/dashboard')

    expect(await screen.findByRole('heading', { level: 1, name: /Welcome back/ })).toBeVisible()
    await expectHref(router, '/dashboard')
    expect(loads).toEqual(['/dashboard'])
    expect(await findSwitcher('Choose a tenant')).toBeInTheDocument()
  })

  it('removes a ?tenant it cannot use when the user has no eligible tenant', async () => {
    serveTenants([UMBRELLA])
    const { router, loads } = renderAt('/dashboard?tenant=umbrella&foo=bar')

    await expectHref(router, '/dashboard?foo=bar')
    expect(loads).toHaveLength(2)
    expect(await findSwitcher('Choose a tenant')).toBeInTheDocument()
  })

  it('renders the page without redirecting when the tenant list fails to load', async () => {
    server.use(http.get('/api/v1/tenants', () => fail('Something went wrong.', 500)))
    const { router, loads } = renderAt('/dashboard?tenant=acme')

    expect(await screen.findByRole('heading', { level: 1, name: /Welcome back/ })).toBeVisible()
    expect(router.state.location.href).toBe('/dashboard?tenant=acme')
    expect(loads).toEqual(['/dashboard?tenant=acme'])
  })

  it('renders a page with no ?tenant as it is when the list fails to load', async () => {
    server.use(http.get('/api/v1/tenants', () => fail('Something went wrong.', 500)))
    const { router, loads } = renderAt('/dashboard')

    expect(await screen.findByRole('heading', { level: 1, name: /Welcome back/ })).toBeVisible()
    expect(router.state.location.href).toBe('/dashboard')
    expect(loads).toEqual(['/dashboard'])
  })
  it('counts one page view for a page whose ?tenant the guard fills', async () => {
    serveTenants([ACME])
    const capturePageview = vi.spyOn(analytics, 'capturePageview').mockImplementation(() => {})
    const { router } = renderAt('/dashboard')
    const uninstallAnalytics = installRouteAnalytics(router)

    try {
      await expectHref(router, '/dashboard?tenant=acme')
      expect(await findSwitcher('Acme Corp')).toBeInTheDocument()
      expect(capturePageview).toHaveBeenCalledTimes(1)
    } finally {
      uninstallAnalytics()
    }
  })

  it('neither redirects nor remembers for a hover preload', async () => {
    serveTenants([ACME, GLOBEX])
    const { router } = renderAt('/dashboard?tenant=acme')
    expect(await findSwitcher('Acme Corp')).toBeInTheDocument()

    await router.preloadRoute({ to: '/notifications', search: { tenant: 'globex' } })

    expect(readRememberedTenant(testUser.id)).toBe('acme')
    expect(router.state.location.href).toBe('/dashboard?tenant=acme')
  })
})

describe('a tenant list that fails or is slow', () => {
  it('corrects the URL once a list that failed loads', async () => {
    let attempt = 0
    server.use(
      http.get('/api/v1/tenants', () => {
        attempt += 1
        return attempt === 1
          ? fail('Something went wrong.', 500)
          : ok([listed(ACME)], 'Tenants retrieved.')
      }),
      http.get('/api/v1/tenants/acme', () => ok(tenantDetail(ACME, 'owner'), 'Tenant retrieved.'))
    )
    const { router } = renderAt('/settings?tenant=initech')

    // The shell's own list read (useTenants) succeeds; the guard runs again and replaces the stale value.
    await expectHref(router, '/settings?tenant=acme')
    const workspace = await screen.findByRole('region', { name: 'Workspace' })
    await waitFor(() =>
      expect(within(workspace).getByRole('link', { name: /^Members/ })).toHaveAttribute(
        'href',
        '/settings/workspace/acme/members'
      )
    )
  })

  it('holds the page slot until a slow list lands, then renders the corrected page', async () => {
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
    const { router } = renderAt('/dashboard')

    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { level: 1, name: /Welcome back/ })
    ).not.toBeInTheDocument()

    release()
    await expectHref(router, '/dashboard?tenant=acme')
    expect(await screen.findByRole('heading', { level: 1, name: /Welcome back/ })).toBeVisible()
  })

  it('fills ?tenant when a slow list arrives', async () => {
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
    const { router } = renderAt('/dashboard')
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(router.state.location.href).toBe('/dashboard')

    release()

    await expectHref(router, '/dashboard?tenant=acme')
    expect(await findSwitcher('Acme Corp')).toBeInTheDocument()
  })
})

describe('?tenant on $slug pages', () => {
  it('removes a ?tenant from a tenant page, replacing the entry', async () => {
    serveTenants([ACME, GLOBEX])
    const { router, history } = renderAt('/tenants/acme?tenant=globex')

    await expectHref(router, '/tenants/acme')
    expect(await findSwitcher('Acme Corp')).toBeInTheDocument()
    expect(history.length).toBe(1)
  })

  it('removes a ?tenant from a workspace settings page', async () => {
    serveTenants([ACME, GLOBEX])
    server.use(http.get('/api/v1/tenants/acme/members', () => ok([], 'Members retrieved.')))
    const { router } = renderAt('/settings/workspace/acme/members?tenant=globex')

    await expectHref(router, '/settings/workspace/acme/members')
  })
})

describe('carrying the tenant between pages', () => {
  it('lands on /dashboard?tenant=acme after leaving /tenants/acme', async () => {
    serveTenants([GLOBEX, ACME])
    const { router, loads } = renderAt('/tenants/acme')
    expect(await findSwitcher('Acme Corp')).toBeInTheDocument()

    const nav = screen.getByRole('navigation', { name: 'Main' })
    const dashboard = within(nav).getByRole('link', { name: 'Dashboard' })
    expect(dashboard).toHaveAttribute('href', '/dashboard?tenant=acme')
    await userEvent.setup().click(dashboard)

    await expectHref(router, '/dashboard?tenant=acme')
    expect(loads).toEqual(['/tenants/acme', '/dashboard?tenant=acme'])
    expect(await findSwitcher('Acme Corp')).toBeInTheDocument()
  })

  it('links the shell to the tenant just opened, not the one before it', async () => {
    serveTenants([GLOBEX, ACME])
    const { router } = renderAt('/dashboard?tenant=globex')
    expect(await findSwitcher('Globex')).toBeInTheDocument()

    await router.navigate({ to: '/tenants/$slug', params: { slug: 'acme' } })
    await expectHref(router, '/tenants/acme')
    expect(await findSwitcher('Acme Corp')).toBeInTheDocument()

    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'href',
      '/dashboard?tenant=acme'
    )
  })

  it('lands on /tenants/globex with no stale ?tenant from /dashboard?tenant=acme', async () => {
    serveTenants([ACME, GLOBEX])
    const { router, loads } = renderAt('/dashboard?tenant=acme')
    expect(await findSwitcher('Acme Corp')).toBeInTheDocument()

    expect(router.buildLocation({ to: '/tenants/$slug', params: { slug: 'globex' } }).href).toBe(
      '/tenants/globex'
    )
    await router.navigate({ to: '/tenants/$slug', params: { slug: 'globex' } })

    await expectHref(router, '/tenants/globex')
    expect(loads).toEqual(['/dashboard?tenant=acme', '/tenants/globex'])
    expect(await findSwitcher('Globex')).toBeInTheDocument()
  })

  it('carries ?tenant between pages without $slug', async () => {
    serveTenants([ACME, GLOBEX])
    const { router, loads } = renderAt('/dashboard?tenant=globex')
    expect(await findSwitcher('Globex')).toBeInTheDocument()

    await router.navigate({ to: '/notifications' })

    await expectHref(router, '/notifications?tenant=globex')
    expect(loads).toEqual(['/dashboard?tenant=globex', '/notifications?tenant=globex'])
  })

  it('lets an explicit search choose the tenant', async () => {
    serveTenants([ACME, GLOBEX])
    const { router } = renderAt('/dashboard?tenant=globex')
    expect(await findSwitcher('Globex')).toBeInTheDocument()

    await router.navigate({ to: '/notifications', search: { tenant: 'acme' } })

    await expectHref(router, '/notifications?tenant=acme')
    expect(await findSwitcher('Acme Corp')).toBeInTheDocument()
  })

  it('carries no tenant out of a page outside the shell', async () => {
    serveTenants([ACME, GLOBEX])
    const { router } = renderAt('/tenants/globex')
    expect(await findSwitcher('Globex')).toBeInTheDocument()

    await router.navigate({ to: '/verify-email' })
    await waitFor(() => expect(router.state.location.pathname).toBe('/verify-email'))
    // Opening globex remembered it; a different remembered tenant tells a carried tenant from the fallback.
    useCurrentTenantStore.getState().remember(testUser.id, 'acme')
    await router.navigate({ to: '/dashboard' })

    await expectHref(router, '/dashboard?tenant=acme')
  })
})

describe('switching tenant on a page without $slug', () => {
  it('stays on the page, changes only ?tenant, and Back returns to the previous tenant', async () => {
    serveTenants([ACME, GLOBEX])
    const { router, history } = renderAt('/settings/account/profile?tenant=acme')
    const user = userEvent.setup()
    await user.click(await findSwitcher('Acme Corp'))
    await user.click(await screen.findByRole('option', { name: 'Globex' }))

    await expectHref(router, '/settings/account/profile?tenant=globex')
    expect(await findSwitcher('Globex')).toBeInTheDocument()
    expect(readRememberedTenant(testUser.id)).toBe('globex')

    history.back()

    await expectHref(router, '/settings/account/profile?tenant=acme')
    expect(await findSwitcher('Acme Corp')).toBeInTheDocument()
  })

  it('opens the chosen tenant from a tenant page', async () => {
    serveTenants([ACME, GLOBEX])
    const { router } = renderAt('/tenants/acme')
    const user = userEvent.setup()
    await user.click(await findSwitcher('Acme Corp'))
    await user.click(await screen.findByRole('option', { name: 'Globex' }))

    await expectHref(router, '/tenants/globex')
  })
})
