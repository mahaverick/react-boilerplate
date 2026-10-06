import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { delay, http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { RouteNotFound } from '@/components/features/route-not-found'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, tenantDetail, testFlags, testUser } from '@/tests/mocks/handlers'
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

/** How many times `GET /tenants/acme/beta` was asked. */
let betaReads: number
/** How many times `GET /tenants/acme/flags` was asked. */
let flagReads: number

function mockTenant(isBetaOn: boolean) {
  server.use(
    http.get('/api/v1/tenants', () => ok([{ tenant: TENANT, role: 'owner' }], 'Tenants.')),
    http.get('/api/v1/tenants/acme', () => ok(tenantDetail(TENANT, 'owner'), 'Tenant.')),
    http.get('/api/v1/tenants/acme/flags', () => {
      flagReads += 1
      return ok(testFlags({ example_beta_page: isBetaOn }), 'Flags retrieved.')
    }),
    http.get('/api/v1/tenants/acme/beta', () => {
      betaReads += 1
      return isBetaOn
        ? ok({ slug: 'acme', enabledAt: '2026-10-05T09:00:00.000Z' }, 'Beta features are on.')
        : fail('Not found', 404)
    })
  )
}

/** The app router's not-found screen, which `requireClientFlag`'s `notFound()` renders. */
function renderAppAt(path: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
    defaultNotFoundComponent: RouteNotFound,
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
  betaReads = 0
  flagReads = 0
  useAuthStore.setState({
    accessToken: 'access-token',
    user: testUser,
    isAuthenticated: true,
    isBootstrapped: true,
  })
})

describe('the Beta tab', () => {
  it('is in the tab bar while example_beta_page is on', async () => {
    mockTenant(true)
    renderAppAt('/tenants/acme')
    const nav = await screen.findByRole('navigation', { name: 'Tenant sections' })
    await waitFor(() => expect(nav).toHaveTextContent('Beta'))
    expect(screen.getByRole('link', { name: 'Beta' })).toHaveAttribute('href', '/tenants/acme/beta')
  })

  it('is left out while it is off', async () => {
    mockTenant(false)
    renderAppAt('/tenants/acme')
    const nav = await screen.findByRole('navigation', { name: 'Tenant sections' })
    expect(nav).toHaveTextContent('Settings')
    expect(screen.queryByRole('link', { name: 'Beta' })).toBeNull()
  })
})

describe('the Beta page', () => {
  it('shows what the gated API route answers while the flag is on', async () => {
    mockTenant(true)
    renderAppAt('/tenants/acme/beta')
    expect(await screen.findByText('Beta features are on for acme.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Beta', level: 2 })).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('Beta · acme · React Boilerplate'))
  })

  it('does not exist while the flag is off, and never asks the API', async () => {
    mockTenant(false)
    renderAppAt('/tenants/acme/beta')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(betaReads).toBe(0)
  })

  it('does not exist when the flags cannot be read', async () => {
    mockTenant(true)
    server.use(http.get('/api/v1/tenants/acme/flags', () => fail('Boom', 500)))
    renderAppAt('/tenants/acme/beta')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(betaReads).toBe(0)
  })

  it('shows not found and drops the tab when the flag closed after the page was allowed', async () => {
    let isBetaOn = true
    mockTenant(true)
    server.use(
      http.get('/api/v1/tenants/acme/flags', () => {
        flagReads += 1
        return ok(testFlags({ example_beta_page: isBetaOn }), 'Flags retrieved.')
      }),
      http.get('/api/v1/tenants/acme/beta', () => {
        betaReads += 1
        // The flag is turned off between the page opening and its API read.
        isBetaOn = false
        return fail('Not found', 404)
      })
    )
    renderAppAt('/tenants/acme/beta')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Tenant sections' })
    await waitFor(() => expect(within(nav).queryByRole('link', { name: 'Beta' })).toBeNull())
    expect(nav).toHaveTextContent('Settings')
  })

  it('offers a retry, after re-reading the flags once, when the API 404s with the flag still on', async () => {
    mockTenant(true)
    server.use(
      http.get('/api/v1/tenants/acme/beta', () => {
        betaReads += 1
        return fail('Not found', 404)
      })
    )
    renderAppAt('/tenants/acme/beta')
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(
      screen.getByText('We could not load the beta features for this tenant.')
    ).toBeInTheDocument()
    // The beta query's own retry is done once its error shows.
    const betaReadsAtError = betaReads
    await waitFor(() => expect(flagReads).toBe(2))
    await settle(500, 'absence has no event: a re-read loop would have asked again by now')
    expect(flagReads).toBe(2)
    expect(betaReads).toBe(betaReadsAtError)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Tenant sections' })
    expect(within(nav).getByRole('link', { name: 'Beta' })).toBeInTheDocument()
  })
})

const GLOBEX = {
  ...TENANT,
  id: '00000000-0000-4000-8000-0000000000b2',
  name: 'Globex',
  slug: 'globex',
}

/** Two tenants: acme with the beta flag off, globex with it on. Counts the flags reads per tenant. */
function mockTwoTenants(options: { globexFlags?: 'ok' | 'fail' } = {}) {
  const reads = { acme: 0, globex: 0, globexDetail: 0 }
  server.use(
    http.get('/api/v1/tenants', () =>
      ok(
        [
          { tenant: TENANT, role: 'owner' },
          { tenant: GLOBEX, role: 'owner' },
        ],
        'Tenants.'
      )
    ),
    http.get('/api/v1/tenants/acme', () => ok(tenantDetail(TENANT, 'owner'), 'Tenant.')),
    http.get('/api/v1/tenants/globex', () => {
      reads.globexDetail += 1
      return ok(tenantDetail(GLOBEX, 'owner'), 'Tenant.')
    }),
    http.get('/api/v1/tenants/acme/flags', () => {
      reads.acme += 1
      return ok(testFlags({ example_beta_page: false }), 'Flags retrieved.')
    }),
    http.get('/api/v1/tenants/globex/flags', async () => {
      reads.globex += 1
      await delay(40)
      if (options.globexFlags === 'fail') return fail('Boom', 500)
      return ok(testFlags({ example_beta_page: true }), 'Flags retrieved.')
    })
  )
  return reads
}

describe('a tenant switch', () => {
  it('renders the new tenant’s flag values on first paint, with no fallback flash', async () => {
    const reads = mockTwoTenants()
    const router = renderAppAt('/tenants/acme')
    await screen.findByRole('heading', { name: 'Acme Corp' })
    expect(screen.queryByRole('link', { name: 'Beta' })).toBeNull()

    await act(() => router.navigate({ to: '/tenants/$slug', params: { slug: 'globex' } }))
    await screen.findByRole('heading', { name: 'Globex' })

    expect(screen.getByRole('link', { name: 'Beta' })).toHaveAttribute(
      'href',
      '/tenants/globex/beta'
    )
    expect(reads.globex).toBe(1)
  })

  it('makes no flags request for a hover preload of another tenant', async () => {
    const reads = mockTwoTenants()
    const router = renderAppAt('/tenants/acme')
    await screen.findByRole('heading', { name: 'Acme Corp' })

    await act(() => router.preloadRoute({ to: '/tenants/$slug', params: { slug: 'globex' } }))

    expect(reads.globexDetail).toBe(1)
    expect(reads.globex).toBe(0)
  })

  it('loads the flags once for a click that follows a hover preload, and the detail once', async () => {
    const reads = mockTwoTenants()
    const router = renderAppAt('/tenants/acme')
    await screen.findByRole('heading', { name: 'Acme Corp' })

    await act(() => router.preloadRoute({ to: '/tenants/$slug', params: { slug: 'globex' } }))
    expect(reads.globex).toBe(0)
    await act(() => router.navigate({ to: '/tenants/$slug', params: { slug: 'globex' } }))
    await screen.findByRole('heading', { name: 'Globex' })

    expect(screen.getByRole('link', { name: 'Beta' })).toBeInTheDocument()
    expect(reads.globex).toBe(1)
    expect(reads.globexDetail).toBe(1)
  })

  it('still opens the tenant, with the fallbacks, when its flags cannot be read', async () => {
    const reads = mockTwoTenants({ globexFlags: 'fail' })
    const router = renderAppAt('/tenants/acme')
    await screen.findByRole('heading', { name: 'Acme Corp' })

    await act(() => router.navigate({ to: '/tenants/$slug', params: { slug: 'globex' } }))

    expect(await screen.findByRole('heading', { name: 'Globex' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Tenant sections' })).toHaveTextContent(
      'Settings'
    )
    expect(screen.queryByRole('link', { name: 'Beta' })).toBeNull()
    // The loader's read, then the page's own query reading again after the failure.
    await waitFor(() => expect(reads.globex).toBeGreaterThanOrEqual(2))
  })
})
