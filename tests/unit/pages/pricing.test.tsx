import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vite-plus/test'
import type { MembershipRole } from '@/constants/roles'
import { resetSessionForTests } from '@/http/session'
import * as analytics from '@/observability/telemetry'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { useMaintenanceModeStore } from '@/states/maintenance-mode.store'
import { testPlans } from '@/tests/fixtures/billing'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { PlansResponse } from '@/types/billing.types'

const ACME = {
  id: TENANT_ID,
  name: 'Acme',
  slug: 'acme',
  description: null,
  logo: null,
  website: null,
  lifecycleState: 'active',
  deletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  isPlatform: false,
}

/**
 * Answers `GET /tenants` with Acme, where the caller has `role`.
 * @param role - The caller's role in Acme.
 */
function memberOfAcme(role: MembershipRole) {
  server.use(
    http.get('/api/v1/tenants', () =>
      ok(
        listPage([{ tenant: ACME, role, isPlatform: false, joinedAt: '2026-01-01T00:00:00.000Z' }]),
        'Tenants retrieved.'
      )
    )
  )
}

/**
 * Answers `GET /plans` with the fixture, changed by `overrides`.
 * @param overrides - Fields to replace.
 */
function plansWith(overrides: Partial<PlansResponse>) {
  server.use(
    http.get('/api/v1/plans', () => ok({ ...testPlans, ...overrides }, 'Plans retrieved.'))
  )
}

/**
 * Mounts the real route tree at `path`.
 * @param path - The URL to open.
 * @returns The router.
 */
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

/** Signs `testUser` in, as the boot would have. */
function signIn() {
  useAuthStore.setState({
    accessToken: 'access-token',
    user: testUser,
    isAuthenticated: true,
    isBootstrapped: true,
  })
}

/** A visitor the boot has already settled as signed out. */
function signOut() {
  useAuthStore.setState({
    accessToken: null,
    user: null,
    isAuthenticated: false,
    isBootstrapped: true,
  })
}

/** The plan column titled `name`. */
async function column(name: string) {
  return within(await screen.findByRole('region', { name }))
}

let track: MockInstance<typeof analytics.track>

beforeEach(() => {
  resetSessionForTests()
  queryClient.clear()
  useMaintenanceModeStore.setState({ mode: 'off', message: null, since: null })
  track = vi.spyOn(analytics, 'track')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('/pricing', () => {
  it('titles the page Pricing, heads it Plans and tracks a signed-out view once', async () => {
    signOut()
    renderAppAt('/pricing')

    expect(await screen.findByRole('heading', { level: 1, name: 'Plans' })).toBeInTheDocument()
    await waitFor(() => {
      expect(document.title).toMatch(/^Pricing/)
    })
    expect(track.mock.calls.filter(([event]) => event === 'pricing_viewed')).toEqual([
      ['pricing_viewed', { signed_in: false }],
    ])
  })

  it('tracks a signed-in view as signed in', async () => {
    signIn()
    renderAppAt('/pricing')

    await screen.findByRole('heading', { level: 1, name: 'Plans' })
    expect(track.mock.calls.filter(([event]) => event === 'pricing_viewed')).toEqual([
      ['pricing_viewed', { signed_in: true }],
    ])
  })

  it('shows both plans in sort order, with both Paid prices and ₹0 for Free', async () => {
    signOut()
    // Paid listed first: the page orders by sortOrder, not by the response.
    plansWith({ plans: [...testPlans.plans].reverse() })
    renderAppAt('/pricing')

    const free = await column('Free')
    const paid = await column('Paid')
    expect(free.getByText('₹0')).toBeInTheDocument()
    expect(paid.getByText('₹999 per month')).toBeInTheDocument()
    expect(paid.getByText('or ₹9,990 per year (2 months free)')).toBeInTheDocument()

    const headings = screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent)
    expect(headings.indexOf('Free')).toBeLessThan(headings.indexOf('Paid'))
  })

  it('lists every catalog entry per plan: a number or No limit, and included or not', async () => {
    signOut()
    renderAppAt('/pricing')

    const free = await column('Free')
    const paid = await column('Paid')
    expect(free.getByText('3')).toBeInTheDocument()
    expect(paid.getByText('No limit')).toBeInTheDocument()
    expect(free.getByText('Insights')).toBeInTheDocument()
    expect(free.getByText('Not included')).toBeInTheDocument()
    expect(paid.getByText('Included')).toBeInTheDocument()
  })

  it('says GST is included, and answers the tax question, only when GST-registered', async () => {
    signOut()
    plansWith({ gstRegistered: true })
    renderAppAt('/pricing')

    const paid = await column('Paid')
    expect(paid.getByText('Includes 18% GST')).toBeInTheDocument()
    expect(screen.getByText('Do prices include tax?')).toBeInTheDocument()
    expect(screen.getByText('Yes. Prices include 18% GST.')).toBeInTheDocument()
  })

  it('leaves out GST when not registered', async () => {
    signOut()
    renderAppAt('/pricing')

    await screen.findByRole('heading', { level: 1, name: 'Plans' })
    await column('Paid')
    expect(screen.queryByText('Includes 18% GST')).not.toBeInTheDocument()
    expect(screen.queryByText('Do prices include tax?')).not.toBeInTheDocument()
  })

  it('answers the trial, cancel and payment questions', async () => {
    signOut()
    renderAppAt('/pricing')

    await column('Paid')
    expect(screen.getByText('What happens when my trial ends?')).toBeInTheDocument()
    expect(
      screen.getByText(
        'You move to Free. Nothing is deleted. Members and data stay; you can’t add more than Free allows.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Can I cancel any time?')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Yes. Cancel from Billing in one step. You keep Paid until the end of the period you paid for.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('How can I pay?')).toBeInTheDocument()
    expect(
      screen.getByText('Cards and UPI, through Razorpay. Yearly plans are charged once a year.')
    ).toBeInTheDocument()
  })

  describe('signed out', () => {
    beforeEach(signOut)

    it('offers Start free, to sign-in, with the trial line from trial.days', async () => {
      plansWith({ trial: { enabled: true, days: 21 } })
      renderAppAt('/pricing')

      const start = await screen.findByRole('link', { name: 'Start free' })
      expect(start).toHaveAttribute('href', '/login')
      expect(screen.getByText('Try Paid free for 21 days. No card needed.')).toBeInTheDocument()
    })

    it('has no trial line when the trial is off', async () => {
      plansWith({ trial: { enabled: false, days: 14 } })
      renderAppAt('/pricing')

      await screen.findByRole('link', { name: 'Start free' })
      expect(screen.queryByText(/Try Paid free/)).not.toBeInTheDocument()
    })

    it('reads the plans with no bearer and no refresh, and stays on /pricing', async () => {
      let refreshes = 0
      let tenantsReads = 0
      const authorization: (string | null)[] = []
      server.use(
        http.post('/api/v1/auth/refresh', () => {
          refreshes += 1
          return fail('Unauthorized', 401)
        }),
        http.get('/api/v1/tenants', () => {
          tenantsReads += 1
          return fail('Unauthorized', 401)
        }),
        http.get('/api/v1/plans', ({ request }) => {
          authorization.push(request.headers.get('authorization'))
          return ok(testPlans, 'Plans retrieved.')
        })
      )
      const router = renderAppAt('/pricing')

      await screen.findByRole('link', { name: 'Start free' })
      expect(authorization).toEqual([null])
      expect(refreshes).toBe(0)
      expect(tenantsReads).toBe(0)
      expect(router.state.location.pathname).toBe('/pricing')
    })

    it('on a cold load, makes only the boot refresh and stays on /pricing', async () => {
      useAuthStore.setState({ isBootstrapped: false })
      let refreshes = 0
      server.use(
        http.post('/api/v1/auth/refresh', () => {
          refreshes += 1
          return fail('Unauthorized', 401)
        })
      )
      const router = renderAppAt('/pricing')

      await screen.findByRole('link', { name: 'Start free' })
      expect(refreshes).toBe(1)
      expect(router.state.location.pathname).toBe('/pricing')
    })
  })

  describe('signed in', () => {
    beforeEach(signIn)

    it('offers the owner of the current tenant Upgrade, to its billing page', async () => {
      memberOfAcme('owner')
      renderAppAt('/pricing?tenant=acme')

      const upgrade = await screen.findByRole('link', { name: 'Upgrade' })
      expect(upgrade).toHaveAttribute('href', '/settings/workspace/acme/billing')
      expect(screen.queryByRole('link', { name: 'Start free' })).not.toBeInTheDocument()
    })

    it('says payments are not set up instead of Upgrade when payments are off', async () => {
      memberOfAcme('owner')
      plansWith({ paymentsEnabled: false })
      renderAppAt('/pricing?tenant=acme')

      expect(await screen.findByText('Payments aren’t set up yet.')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Upgrade' })).not.toBeInTheDocument()
    })

    it('sends an admin who does not own the current tenant to their workspaces', async () => {
      memberOfAcme('admin')
      renderAppAt('/pricing?tenant=acme')

      const go = await screen.findByRole('link', { name: 'Go to your workspaces' })
      // The shell's retainTenant keeps ?tenant on a link into `_app`.
      expect(go).toHaveAttribute('href', '/tenants?tenant=acme')
      expect(screen.queryByRole('link', { name: 'Upgrade' })).not.toBeInTheDocument()
    })

    it('sends an owner with no current tenant in the URL to their workspaces', async () => {
      memberOfAcme('owner')
      renderAppAt('/pricing')

      expect(await screen.findByRole('link', { name: 'Go to your workspaces' })).toHaveAttribute(
        'href',
        '/tenants'
      )
      expect(screen.queryByRole('link', { name: 'Upgrade' })).not.toBeInTheDocument()
    })
  })

  it('shows a retry when the plans do not load', async () => {
    signOut()
    server.use(http.get('/api/v1/plans', () => fail('Server error', 500)))
    renderAppAt('/pricing')

    expect(await screen.findByRole('alert')).toHaveTextContent('Plans didn’t load. Try again.')
    expect(screen.getByRole('heading', { level: 1, name: 'Plans' })).toBeInTheDocument()
  })
})
