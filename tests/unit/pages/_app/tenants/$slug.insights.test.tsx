import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { resetSessionForTests } from '@/http/session'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { fail, ok, tenantDetail, testEntitlements, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

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

/** How many times `GET /tenants/acme/insights` was asked. */
let insightsReads: number

/** Free: no `advanced_example`. */
const FREE = testEntitlements({
  plan: { key: 'free', name: 'Free' },
  state: 'free',
  trialEndsAt: null,
  features: { advanced_example: false },
})

/** Serves the acme tenant to its owner, with the given entitlements and insights answer. */
function mockTenant(
  entitlements: ReturnType<typeof testEntitlements>,
  insights: () => Response | Promise<Response>
) {
  server.use(
    http.get('/api/v1/tenants', () =>
      ok(
        listPage([
          {
            tenant: TENANT,
            role: 'owner',
            isPlatform: false,
            joinedAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
        'Tenants.'
      )
    ),
    http.get('/api/v1/tenants/acme', () => ok(tenantDetail(TENANT, 'owner'), 'Tenant.')),
    http.get('/api/v1/tenants/acme/entitlements', () => ok(entitlements, 'Entitlements.')),
    http.get('/api/v1/tenants/acme/insights', () => {
      insightsReads += 1
      return insights()
    })
  )
}

/** Renders the app at `path`. */
function renderAppAt(path: string) {
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
  return router
}

beforeEach(() => {
  resetSessionForTests()
  queryClient.clear()
  insightsReads = 0
  useAuthStore.setState({
    accessToken: 'access-token',
    user: testUser,
    isAuthenticated: true,
    isBootstrapped: true,
  })
})

describe('the Insights page', () => {
  it('shows both counts when the plan includes the feature', async () => {
    mockTenant(testEntitlements(), () =>
      ok({ membersJoinedLast30Days: 4, invitationsSentLast30Days: 7 }, 'Insights.')
    )
    renderAppAt('/tenants/acme/insights')
    expect(await screen.findByText('Members joined, last 30 days')).toBeInTheDocument()
    expect(screen.getByText('Invitations sent, last 30 days')).toBeInTheDocument()
    expect(await screen.findByText('4')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.queryByText('Included in Paid.')).toBeNull()
    await waitFor(() => expect(document.title).toBe('Insights · acme · React Boilerplate'))
  })

  it('shows the locked card on Free, and never asks the API', async () => {
    mockTenant(FREE, () => fail('Not asked', 500))
    renderAppAt('/tenants/acme/insights')
    expect(await screen.findByText('Included in Paid.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Workspace insights', level: 2 })).toBeVisible()
    expect(
      screen.getByText('See who joined and how many invitations went out in the last 30 days.')
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Upgrade' })).toBeInTheDocument()
    expect(insightsReads).toBe(0)
  })

  it('shows the locked card when the entitlements are stale and the API answers 402', async () => {
    mockTenant(testEntitlements(), () =>
      fail('Insights are included in Paid.', 402, 'PLAN_FEATURE_REQUIRED', {
        key: 'advanced_example',
      })
    )
    renderAppAt('/tenants/acme/insights')
    expect(await screen.findByText('Included in Paid.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Workspace insights', level: 2 })).toBeVisible()
    expect(insightsReads).toBe(1)
  })

  it('shows a retryable error for any other failure, asking once', async () => {
    mockTenant(testEntitlements(), () => fail('Boom', 500))
    renderAppAt('/tenants/acme/insights')
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(insightsReads).toBe(1)
  })
})

describe('the Insights tab', () => {
  it('is in the tab bar', async () => {
    mockTenant(testEntitlements(), () =>
      ok({ membersJoinedLast30Days: 0, invitationsSentLast30Days: 0 }, 'Insights.')
    )
    renderAppAt('/tenants/acme')
    expect(await screen.findByRole('link', { name: 'Insights' })).toHaveAttribute(
      'href',
      '/tenants/acme/insights'
    )
  })
})
