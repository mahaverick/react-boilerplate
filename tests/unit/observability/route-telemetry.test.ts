import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { identityEpoch } from '@/observability/identity-epoch'
import {
  installRouteAnalytics,
  TENANT_GROUP_WAIT_MS,
  TENANT_ROUTE_IDS,
} from '@/observability/route-telemetry'
import { initAnalytics, resetAnalyticsForTests } from '@/observability/telemetry/telemetry'
import { analyticsConfigFor, resetFakePosthog, sdk } from '@/tests/mocks/posthog'

vi.mock('posthog-js', async () => {
  const { posthogDefault } = await import('@/tests/mocks/posthog')
  return { default: posthogDefault }
})

/** What each tenant slug's loader resolves to: `GET /tenants/:slug`'s shape, `null` for a 404. */
const TENANTS: Record<string, unknown> = {
  acme: { id: 'tenant-acme', access: 'member' },
  globex: { id: 'tenant-globex', access: 'member' },
  initech: { id: 'tenant-initech', access: 'platform' },
  gone: null,
}

/** Each slug's tenant read: resolved at once, unless a test holds it. */
const reads = new Map<string, Promise<unknown>>()

/** The tenant read a tenant route's loader hands over for `slug`. */
function tenantFor(slug: string): Promise<unknown> {
  return reads.get(slug) ?? Promise.resolve(TENANTS[slug] ?? null)
}

/** A small tree shaped like the app's: both tenant layouts under the pathless `_app` layout. */
function makeRouter(initialPath: string) {
  const rootRoute = createRootRoute({ component: Outlet })
  const appRoute = createRoute({ getParentRoute: () => rootRoute, id: '_app', component: Outlet })
  const profileRoute = createRoute({ getParentRoute: () => appRoute, path: 'profile' })
  const tenantRoute = createRoute({
    getParentRoute: () => appRoute,
    path: 'tenants/$slug',
    loader: ({ params }) => {
      if (params.slug === 'broken') return { tenant: Promise.resolve(null) }
      return { tenant: tenantFor(params.slug) }
    },
  })
  const membersRoute = createRoute({ getParentRoute: () => tenantRoute, path: 'members' })
  const settingsRoute = createRoute({ getParentRoute: () => appRoute, path: 'settings' })
  const workspaceRoute = createRoute({
    getParentRoute: () => settingsRoute,
    path: 'workspace/$slug',
    loader: ({ params }) => {
      if (params.slug === 'broken') return { tenant: Promise.resolve(null) }
      return { tenant: tenantFor(params.slug) }
    },
  })
  const workspaceMembersRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: 'members',
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      appRoute.addChildren([
        profileRoute,
        tenantRoute.addChildren([membersRoute]),
        settingsRoute.addChildren([workspaceRoute.addChildren([workspaceMembersRoute])]),
      ]),
    ]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })
  return router
}

/** The SDK calls that decide attribution, after `init`'s own `register` of the app. */
function attributionCalls(): string[] {
  return sdk.calls.filter((call) => !call.includes('"app"'))
}

/** How many page views have been captured since `sdk.calls` was last cleared. */
function pageviews(): number {
  return sdk.calls.filter((call) => call.startsWith('capture("$pageview"')).length
}

/** The SDK call for a page view of `path`, carrying the location the router resolved. */
function view(path: string): string {
  const url = new URL(path, window.location.origin)
  const page = { $current_url: url.href, $host: url.host, $pathname: url.pathname }
  return `capture("$pageview", ${JSON.stringify(page)})`
}

const MEMBER = 'register({"tenant_access":"member"})'
const PLATFORM = 'register({"tenant_access":"platform"})'
const LEAVE_TENANT = ['resetGroups()', 'unregister("tenant_access")']

describe('installRouteAnalytics', () => {
  /** Removes the route analytics `start` installed; replaced on each start. */
  let uninstall: () => void = () => {}

  beforeEach(() => {
    resetAnalyticsForTests()
    resetFakePosthog()
    reads.clear()
  })

  afterEach(() => {
    uninstall()
  })

  /** Starts route analytics on a router at `initialPath` and initialises analytics only after that router has loaded, so a test controls what has happened before init. */
  async function start(initialPath: string) {
    const router = makeRouter(initialPath)
    uninstall = installRouteAnalytics(router)
    await router.load()
    await initAnalytics(analyticsConfigFor({ POSTHOG_KEY: 'phc_test_key_not_real' }))
    return router
  }

  it.each(TENANT_ROUTE_IDS)('matches the app’s tenant layout id %s', (id) => {
    expect(makeRouter('/').routesById).toHaveProperty([id])
  })

  it('groups the first page’s tenant before its pageview, queued until the SDK loads', async () => {
    await start('/tenants/acme/members')
    await vi.waitFor(() =>
      expect(attributionCalls()).toEqual([
        MEMBER,
        'group("tenant", "tenant-acme")',
        view('/tenants/acme/members'),
      ])
    )
  })

  it('groups a workspace settings page under its tenant before its pageview', async () => {
    await start('/settings/workspace/acme/members')
    await vi.waitFor(() =>
      expect(attributionCalls()).toEqual([
        MEMBER,
        'group("tenant", "tenant-acme")',
        view('/settings/workspace/acme/members'),
      ])
    )
  })

  it('switching tenants: the new tenant is grouped, then the switch and the pageview are captured', async () => {
    const router = await start('/tenants/acme')
    await vi.waitFor(() => expect(pageviews()).toBe(1))
    sdk.calls = []
    await router.navigate({ to: '/tenants/$slug', params: { slug: 'globex' } })
    await vi.waitFor(() =>
      expect(sdk.calls).toEqual([
        ...LEAVE_TENANT,
        MEMBER,
        'group("tenant", "tenant-globex")',
        'capture("tenant_switched", {})',
        view('/tenants/globex'),
      ])
    )
    expect(sdk.properties.$groups).toEqual({ tenant: 'tenant-globex' })
  })

  it('a non-tenant page leaves the group before its pageview', async () => {
    const router = await start('/tenants/acme')
    await vi.waitFor(() => expect(pageviews()).toBe(1))
    sdk.calls = []
    await router.navigate({ to: '/profile' })
    await vi.waitFor(() => expect(sdk.calls).toEqual([...LEAVE_TENANT, view('/profile')]))
    expect(sdk.properties.$groups).toEqual({})
  })

  it('acme, then profile, then globex is a switch; acme, profile, acme is not', async () => {
    const router = await start('/tenants/acme')
    await router.navigate({ to: '/profile' })
    await router.navigate({ to: '/tenants/$slug', params: { slug: 'acme' } })
    await vi.waitFor(() => expect(pageviews()).toBe(3))
    expect(sdk.calls.filter((call) => call.includes('tenant_switched'))).toEqual([])
    await router.navigate({ to: '/profile' })
    await router.navigate({ to: '/tenants/$slug', params: { slug: 'globex' } })
    await vi.waitFor(() => expect(pageviews()).toBe(5))
    expect(sdk.calls.filter((call) => call.includes('tenant_switched'))).toHaveLength(1)
  })

  it('marks a tenant reached through platform access, and a member tenant after it', async () => {
    const router = await start('/tenants/initech')
    await vi.waitFor(() =>
      expect(attributionCalls()).toEqual([
        PLATFORM,
        'group("tenant", "tenant-initech")',
        view('/tenants/initech'),
      ])
    )
    sdk.calls = []
    await router.navigate({ to: '/tenants/$slug', params: { slug: 'acme' } })
    await vi.waitFor(() => expect(pageviews()).toBe(1))
    expect(sdk.properties.tenant_access).toBe('member')
    await router.navigate({ to: '/profile' })
    await vi.waitFor(() => expect(pageviews()).toBe(2))
    expect(sdk.properties).not.toHaveProperty('tenant_access')
  })

  it.each([
    ['answered 404', 'gone'],
    ['failed to load', 'broken'],
  ])('a tenant page whose tenant %s is in no group', async (_case, slug) => {
    const router = await start('/tenants/acme')
    await vi.waitFor(() => expect(pageviews()).toBe(1))
    sdk.calls = []
    await router.navigate({ to: '/tenants/$slug', params: { slug } })
    await vi.waitFor(() => expect(sdk.calls).toEqual([...LEAVE_TENANT, view(`/tenants/${slug}`)]))
  })

  it('a resolve that keeps the path re-applies the group without a pageview', async () => {
    const router = await start('/tenants/acme')
    await vi.waitFor(() => expect(pageviews()).toBe(1))
    sdk.calls = []
    await router.invalidate()
    await router.navigate({ to: '/tenants/$slug', params: { slug: 'acme' }, search: {} })
    // A later page view is queued behind both resolves above, so once it lands they have run.
    await router.navigate({ to: '/profile' })
    await vi.waitFor(() => expect(pageviews()).toBe(1))
    expect(sdk.calls).toEqual([...LEAVE_TENANT, view('/profile')])
  })

  it('keeps the group for the same tenant’s next page, without touching the identity epoch', async () => {
    const router = await start('/tenants/acme')
    await vi.waitFor(() => expect(pageviews()).toBe(1))
    const before = identityEpoch()
    sdk.calls = []
    await router.navigate({ to: '/tenants/$slug/members', params: { slug: 'acme' } })
    await vi.waitFor(() => expect(pageviews()).toBe(1))
    // No leave and no re-enter: an error noted just before this click is still the user's own.
    expect(sdk.calls).toEqual([view('/tenants/acme/members')])
    expect(identityEpoch()).toBe(before)
  })

  it('keeps the first page’s group when the same tenant’s next page resolves while its read is out', async () => {
    let land!: (tenant: unknown) => void
    reads.set('acme', new Promise((resolve) => (land = resolve)))
    const router = await start('/tenants/acme')
    await router.navigate({ to: '/tenants/$slug/members', params: { slug: 'acme' } })
    land(TENANTS.acme)
    await vi.waitFor(() =>
      expect(attributionCalls()).toEqual([
        MEMBER,
        'group("tenant", "tenant-acme")',
        view('/tenants/acme'),
        view('/tenants/acme/members'),
      ])
    )
  })

  it('leaves the previous tenant’s group as soon as a tenant page resolves, before its read lands', async () => {
    const router = await start('/tenants/acme')
    await vi.waitFor(() => expect(pageviews()).toBe(1))
    sdk.calls = []
    reads.set('globex', new Promise(() => {}))
    await router.navigate({ to: '/tenants/$slug', params: { slug: 'globex' } })
    expect(sdk.calls).toEqual(LEAVE_TENANT)
    expect(sdk.properties).not.toHaveProperty('tenant_access')
  })

  it('cuts an earlier tenant page’s wait short when a newer tenant page resolves, so the newer events carry only their own group', async () => {
    reads.set('acme', new Promise(() => {}))
    const router = await start('/tenants/acme')
    sdk.calls = []
    await router.navigate({ to: '/tenants/$slug', params: { slug: 'globex' } })
    // Acme's view is captured at once with no group, then globex is grouped and viewed: no 10 s wait in between.
    await vi.waitFor(() =>
      expect(attributionCalls()).toEqual([
        view('/tenants/acme'),
        MEMBER,
        'group("tenant", "tenant-globex")',
        view('/tenants/globex'),
      ])
    )
  })

  it('waits for the tenant before the page view, so the view carries its group', async () => {
    let land!: (tenant: unknown) => void
    reads.set('acme', new Promise((resolve) => (land = resolve)))
    await start('/tenants/acme')
    land(TENANTS.acme)
    // The view comes after the group, which only the landed read can set: the view waited for it.
    await vi.waitFor(() =>
      expect(attributionCalls()).toEqual([
        MEMBER,
        'group("tenant", "tenant-acme")',
        view('/tenants/acme'),
      ])
    )
  })

  it('keeps resolve order when the user moves on before the tenant lands', async () => {
    let land!: (tenant: unknown) => void
    reads.set('acme', new Promise((resolve) => (land = resolve)))
    const router = await start('/tenants/acme')
    await router.navigate({ to: '/profile' })
    land(TENANTS.acme)
    // The first view is captured while the router is on /profile, and still records /tenants/acme.
    await vi.waitFor(() =>
      expect(attributionCalls()).toEqual([
        MEMBER,
        'group("tenant", "tenant-acme")',
        view('/tenants/acme'),
        ...LEAVE_TENANT,
        view('/profile'),
      ])
    )
  })

  it('captures the page view without a tenant once TENANT_GROUP_WAIT_MS passes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      reads.set('acme', new Promise(() => {}))
      await start('/tenants/acme')
      await vi.advanceTimersByTimeAsync(TENANT_GROUP_WAIT_MS - 1)
      expect(attributionCalls()).toEqual([])
      await vi.advanceTimersByTimeAsync(1)
      // Nothing was grouped before, so leaving the group sends nothing: the view alone, with no tenant.
      expect(attributionCalls()).toEqual([view('/tenants/acme')])
      expect(sdk.properties).not.toHaveProperty('tenant_access')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a page load that starts on a non-tenant page drops a tenant left in storage first', async () => {
    sdk.properties = { $groups: { tenant: 'tenant-stale' }, tenant_access: 'member' }
    await start('/profile')
    expect(attributionCalls()).toEqual([...LEAVE_TENANT, view('/profile')])
  })
})
