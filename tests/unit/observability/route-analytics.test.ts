import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initAnalytics, resetAnalyticsForTests } from '@/observability/analytics/analytics'
import { installRouteAnalytics, TENANT_ROUTE_ID } from '@/observability/route-analytics'
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

/** A small tree shaped like the app's: the tenant layout under the pathless `_app` layout. */
function makeRouter(initialPath: string) {
  const rootRoute = createRootRoute({ component: Outlet })
  const appRoute = createRoute({ getParentRoute: () => rootRoute, id: '_app', component: Outlet })
  const profileRoute = createRoute({ getParentRoute: () => appRoute, path: 'profile' })
  const tenantRoute = createRoute({
    getParentRoute: () => appRoute,
    path: 'tenants/$slug',
    loader: ({ params }) => {
      if (params.slug === 'broken') throw new Error('load failed')
      return TENANTS[params.slug] ?? null
    },
  })
  const membersRoute = createRoute({ getParentRoute: () => tenantRoute, path: 'members' })
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      appRoute.addChildren([profileRoute, tenantRoute.addChildren([membersRoute])]),
    ]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })
  return router
}

/** The SDK calls that decide attribution, after `init`'s own `register` of the app. */
function attributionCalls(): string[] {
  return sdk.calls.filter((call) => !call.includes('"app"'))
}

const MEMBER = 'register({"tenant_access":"member"})'
const PLATFORM = 'register({"tenant_access":"platform"})'
const LEAVE_TENANT = ['resetGroups()', 'unregister("tenant_access")']

describe('installRouteAnalytics', () => {
  let uninstall: () => void = () => {}

  beforeEach(() => {
    resetAnalyticsForTests()
    resetFakePosthog()
  })

  afterEach(() => {
    uninstall()
  })

  async function start(initialPath: string) {
    const router = makeRouter(initialPath)
    uninstall = installRouteAnalytics(router)
    await router.load()
    await initAnalytics(analyticsConfigFor({ POSTHOG_KEY: 'phc_test_key_not_real' }))
    return router
  }

  it('matches the app’s tenant layout id', () => {
    expect(makeRouter('/').routesById).toHaveProperty([TENANT_ROUTE_ID])
  })

  it('groups the first page’s tenant before its pageview, queued until the SDK loads', async () => {
    await start('/tenants/acme/members')
    expect(attributionCalls()).toEqual([
      MEMBER,
      'group("tenant", "tenant-acme")',
      'capture("$pageview", {})',
    ])
  })

  it('switching tenants: the new tenant is grouped, then the switch and the pageview are captured', async () => {
    const router = await start('/tenants/acme')
    sdk.calls = []
    await router.navigate({ to: '/tenants/$slug', params: { slug: 'globex' } })
    expect(sdk.calls).toEqual([
      MEMBER,
      'group("tenant", "tenant-globex")',
      'capture("tenant_switched", {})',
      'capture("$pageview", {})',
    ])
    expect(sdk.properties.$groups).toEqual({ tenant: 'tenant-globex' })
  })

  it('a non-tenant page leaves the group before its pageview', async () => {
    const router = await start('/tenants/acme')
    sdk.calls = []
    await router.navigate({ to: '/profile' })
    expect(sdk.calls).toEqual([...LEAVE_TENANT, 'capture("$pageview", {})'])
    expect(sdk.properties.$groups).toEqual({})
  })

  it('acme, then profile, then globex is a switch; acme, profile, acme is not', async () => {
    const router = await start('/tenants/acme')
    await router.navigate({ to: '/profile' })
    await router.navigate({ to: '/tenants/$slug', params: { slug: 'acme' } })
    expect(sdk.calls.filter((call) => call.includes('tenant_switched'))).toEqual([])
    await router.navigate({ to: '/profile' })
    await router.navigate({ to: '/tenants/$slug', params: { slug: 'globex' } })
    expect(sdk.calls.filter((call) => call.includes('tenant_switched'))).toHaveLength(1)
  })

  it('marks a tenant reached through platform access, and a member tenant after it', async () => {
    const router = await start('/tenants/initech')
    expect(attributionCalls()).toEqual([
      PLATFORM,
      'group("tenant", "tenant-initech")',
      'capture("$pageview", {})',
    ])
    sdk.calls = []
    await router.navigate({ to: '/tenants/$slug', params: { slug: 'acme' } })
    expect(sdk.properties.tenant_access).toBe('member')
    await router.navigate({ to: '/profile' })
    expect(sdk.properties).not.toHaveProperty('tenant_access')
  })

  it.each([
    ['answered 404', 'gone'],
    ['failed to load', 'broken'],
  ])('a tenant page whose tenant %s is in no group', async (_case, slug) => {
    const router = await start('/tenants/acme')
    sdk.calls = []
    await router.navigate({ to: '/tenants/$slug', params: { slug } })
    expect(sdk.calls).toEqual([...LEAVE_TENANT, 'capture("$pageview", {})'])
  })

  it('a resolve that keeps the path re-applies the group without a pageview', async () => {
    const router = await start('/tenants/acme')
    sdk.calls = []
    await router.invalidate()
    await router.navigate({ to: '/tenants/$slug', params: { slug: 'acme' }, search: {} })
    expect(sdk.calls).toEqual([])
  })

  it('a page load that starts on a non-tenant page drops a tenant left in storage first', async () => {
    sdk.properties = { $groups: { tenant: 'tenant-stale' }, tenant_access: 'member' }
    await start('/profile')
    expect(attributionCalls()).toEqual([...LEAVE_TENANT, 'capture("$pageview", {})'])
  })
})
