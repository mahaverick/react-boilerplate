import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import { delay, http } from 'msw'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { FeatureGate } from '@/components/features/billing/feature-gate'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { settle } from '@/tests/fixtures/timing'
import { ok, tenantDetail, testEntitlements } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const TENANT = {
  id: TENANT_ID,
  name: 'Acme Corp',
  slug: 'acme',
  description: null,
  logo: null,
  website: null,
  lifecycleState: 'active',
  deletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

/** Mounts a gate over the insights feature for acme, as an owner. */
function renderGate() {
  server.use(
    http.get('/api/v1/tenants/acme', () => ok(tenantDetail(TENANT, 'owner'), 'Tenant retrieved.'))
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <FeatureGate
          slug="acme"
          entitlementKey="advanced_example"
          title="Insights"
          valueLine="See who joined and who was invited in the last 30 days."
        >
          <p>The insights themselves</p>
        </FeatureGate>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return client
}

afterEach(() => {
  cleanup()
})

describe('FeatureGate', () => {
  it('renders its children when the plan includes the feature', async () => {
    renderGate()

    expect(await screen.findByText('The insights themselves')).toBeInTheDocument()
    expect(screen.queryByText('Included in Paid.')).toBeNull()
  })

  it('renders the locked card with the upgrade action, never the children, when it does not', async () => {
    server.use(
      http.get('/api/v1/tenants/acme/entitlements', () =>
        ok(
          testEntitlements({
            plan: { key: 'free', name: 'Free' },
            state: 'free',
            trialEndsAt: null,
            features: { advanced_example: false },
            limits: { members: { limit: 3, used: 2, approaching: false } },
          }),
          'Entitlements retrieved.'
        )
      )
    )
    renderGate()

    expect(await screen.findByRole('heading', { name: 'Insights', level: 2 })).toBeInTheDocument()
    expect(
      screen.getByText('See who joined and who was invited in the last 30 days.')
    ).toBeInTheDocument()
    expect(screen.getByText('Included in Paid.')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Upgrade' })).toBeInTheDocument()
    expect(screen.queryByText('The insights themselves')).toBeNull()
  })

  it('renders nothing until the entitlements load', async () => {
    server.use(
      http.get('/api/v1/tenants/acme/entitlements', async () => {
        await delay('infinite')
        return ok(testEntitlements(), 'Entitlements retrieved.')
      })
    )
    const client = renderGate()

    await settle(50, 'a held entitlements read has no event to await')
    expect(client.getQueryState(['tenants', 'acme', 'entitlements'])?.status).toBe('pending')
    expect(screen.queryByText('The insights themselves')).toBeNull()
    expect(screen.queryByText('Included in Paid.')).toBeNull()
  })
})
