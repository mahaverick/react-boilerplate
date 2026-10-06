import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { http } from 'msw'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initAnalytics, resetAnalyticsForTests } from '@/observability/analytics/analytics'
import { resetFlagHooksForTests, useFeaturePropertiesSync } from '@/observability/flags/flag-hooks'
import { ensureFlags } from '@/observability/flags/flag-query'
import { flagScopeFor, installFlagScopeReset } from '@/observability/flags/flag-scope'
import { forgetFeatureProperties } from '@/observability/flags/register'
import { installRouteAnalytics } from '@/observability/route-analytics'
import { ok, testFlags } from '@/tests/mocks/handlers'
import { analyticsConfigFor, instance, resetFakePosthog, sdk } from '@/tests/mocks/posthog'
import { server } from '@/tests/mocks/server'

vi.mock('posthog-js', async () => {
  const { posthogDefault } = await import('@/tests/mocks/posthog')
  return { default: posthogDefault }
})

/** Each tenant's values, different on every flag, so a value carried over shows. */
const TENANT_FLAGS: Record<string, ReturnType<typeof testFlags>> = {
  acme: testFlags({ example_beta_page: true, example_cta_experiment: 'bold' }),
  globex: testFlags({ example_beta_page: false, example_cta_experiment: 'control' }),
}
const ACME = { '$feature/example_beta_page': true, '$feature/example_cta_experiment': 'bold' }
const GLOBEX = { '$feature/example_beta_page': false, '$feature/example_cta_experiment': 'control' }
/** The values with no tenant: every fallback. */
const NO_TENANT = GLOBEX

/** Each capture, with the `$feature/*` super properties the SDK held when it was made. */
let captures: { event: string; features: Record<string, unknown> }[]

function featuresHeld(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(sdk.properties).filter(([name]) => name.startsWith('$feature/'))
  )
}

/**
 * The app's shape: a pathless `_app` layout whose loader warms the flags of
 * the page it is entered on and whose component mounts the `$feature/*`
 * sync, the tenant layout under it, and the router subscriptions
 * `router.tsx` installs, in its order.
 */
function renderApp(initialPath: string) {
  const queryClient = new QueryClient()
  const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
    component: Outlet,
  })
  function AppShell() {
    useFeaturePropertiesSync()
    return <Outlet />
  }
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_app',
    loader: ({ context, params }) =>
      ensureFlags(context.queryClient, flagScopeFor(params as { slug?: string })),
    component: AppShell,
  })
  const profileRoute = createRoute({
    getParentRoute: () => appRoute,
    path: 'profile',
    component: () => <h1>Profile</h1>,
  })
  const tenantRoute = createRoute({
    getParentRoute: () => appRoute,
    path: 'tenants/$slug',
    loader: ({ params }) => ({ id: `tenant-${params.slug}`, access: 'member' }),
    component: function TenantPage() {
      return <h1>{tenantRoute.useParams().slug}</h1>
    },
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([appRoute.addChildren([profileRoute, tenantRoute])]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    context: { queryClient },
  })
  const uninstall = [installRouteAnalytics(router), installFlagScopeReset(router, queryClient)]
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return {
    router,
    cleanup: () => {
      for (const stop of uninstall) stop()
      queryClient.clear()
    },
  }
}

/** Indexes in `sdk.calls` of the calls that start with `prefix`. */
function indexesOf(prefix: string): number[] {
  return sdk.calls.flatMap((call, index) => (call.startsWith(prefix) ? [index] : []))
}

describe('$feature/* across a change of flag scope', () => {
  let cleanup: () => void = () => {}

  beforeEach(async () => {
    resetAnalyticsForTests()
    resetFakePosthog()
    resetFlagHooksForTests()
    forgetFeatureProperties()
    captures = []
    instance.capture.mockImplementation((event: string, properties: unknown) => {
      sdk.calls.push(`capture(${JSON.stringify(event)}, ${JSON.stringify(properties)})`)
      captures.push({ event, features: featuresHeld() })
    })
    server.use(
      http.get('/api/v1/tenants/:slug/flags', ({ params }) =>
        ok(TENANT_FLAGS[String(params.slug)] ?? testFlags())
      ),
      http.get('/api/v1/flags', () => ok(testFlags()))
    )
    await initAnalytics(analyticsConfigFor({ POSTHOG_KEY: 'phc_test_key_not_real' }))
  })

  afterEach(() => {
    cleanup()
    instance.capture.mockRestore()
  })

  async function startOnAcme() {
    const app = renderApp('/tenants/acme')
    cleanup = app.cleanup
    await screen.findByRole('heading', { name: 'acme' })
    await vi.waitFor(() => expect(featuresHeld()).toEqual(ACME))
    expect(captures.find((capture) => capture.event === '$pageview')?.features).toEqual(ACME)
    captures = []
    sdk.calls = []
    return app.router
  }

  it("a tenant switch's events never carry the previous tenant's values; later ones carry the new tenant's", async () => {
    const router = await startOnAcme()

    await act(() => router.navigate({ to: '/tenants/$slug', params: { slug: 'globex' } }))
    await screen.findByRole('heading', { name: 'globex' })

    const [pageview] = indexesOf('capture("$pageview"')
    expect(pageview).toBeDefined()
    const unregisters = indexesOf('unregister("$feature/')
    expect(unregisters).toHaveLength(2)
    for (const index of unregisters) expect(index).toBeLessThan(pageview ?? -1)
    expect(captures.map((capture) => capture.event)).toEqual(['tenant_switched', '$pageview'])
    for (const capture of captures) expect(capture.features).toEqual({})
    await vi.waitFor(() => expect(featuresHeld()).toEqual(GLOBEX))
  })

  it("leaving a tenant for a page with no tenant does not carry the tenant's values either", async () => {
    const router = await startOnAcme()

    await act(() => router.navigate({ to: '/profile' }))
    await screen.findByRole('heading', { name: 'Profile' })

    expect(captures.map((capture) => capture.event)).toEqual(['$pageview'])
    expect(captures[0]?.features).toEqual({})
    await vi.waitFor(() => expect(featuresHeld()).toEqual(NO_TENANT))
  })
})
