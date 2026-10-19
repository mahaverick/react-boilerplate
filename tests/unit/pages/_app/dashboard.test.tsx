import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { ROUTES } from '@/constants/routes'
import { resetSessionForTests } from '@/http/session'
import { tenantKeys } from '@/queries/tenant.queries'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/** What the dashboard says to a user who belongs to no workspace. */
const PROMPT = 'You don’t belong to a workspace yet.'

/** `GET /tenants` with one membership, Acme as owner. */
function oneTenant() {
  return ok(
    listPage([
      {
        tenant: {
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
        },
        role: 'owner',
        isPlatform: false,
        joinedAt: '2026-01-01T00:00:00.000Z',
      },
    ]),
    'Tenants retrieved.'
  )
}

/** Mounts the real route tree on `/dashboard`. */
function renderDashboard() {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ['/dashboard'] }),
    ...ROUTER_DEFAULTS,
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
}

describe('dashboard page', () => {
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

  it('greets the signed-in user under a level-one heading', async () => {
    renderDashboard()

    const heading = await screen.findByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent('Welcome back, A')
  })

  it('falls back to the email when the profile carries no first name', async () => {
    useAuthStore.setState({ user: { ...testUser, firstName: null } })
    renderDashboard()

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      `Welcome back, ${testUser.email}`
    )
  })

  it('names no tenant: scope lives in the URL, not in a dashboard widget', async () => {
    renderDashboard()
    await screen.findByRole('heading', { level: 1 })

    // Scoped to the page because the claim is that the dashboard shows no tenant; a document-wide query would also match the shell's Tenants nav item.
    expect(within(screen.getByRole('main')).queryByText(/tenant/i)).not.toBeInTheDocument()
  })

  it('prompts Create your workspace with no tenants', async () => {
    renderDashboard()

    const main = await screen.findByRole('main')
    expect(await within(main).findByText(PROMPT)).toBeInTheDocument()
    // The greeting stays the page's one h1; the prompt sits beneath it and is not a second heading.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome back, A')
    expect(within(main).queryByRole('heading', { name: 'Create your workspace' })).toBeNull()
    expect(within(main).getByRole('link', { name: 'Create your workspace' })).toHaveAttribute(
      'href',
      ROUTES.welcome
    )
    expect(within(main).queryByText(/intentionally empty/)).not.toBeInTheDocument()
  })

  it('greets as before with a tenant', async () => {
    server.use(http.get('/api/v1/tenants', () => oneTenant()))
    renderDashboard()

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Welcome back, A')
    expect(await screen.findByText(/intentionally empty/)).toBeInTheDocument()
    expect(screen.queryByText(PROMPT)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Create your workspace' })).not.toBeInTheDocument()
  })

  it('greets while the tenant list is loading', async () => {
    // The shell's guard holds the page until the list's first read settles, so the page meets a pending list only on its refetch after a failure.
    let reads = 0
    server.use(
      http.get('/api/v1/tenants', () => {
        reads += 1
        return reads <= 2 ? fail('Something went wrong', 500) : new Promise<Response>(() => {})
      })
    )
    renderDashboard()

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Welcome back, A')
    await waitFor(() => expect(reads).toBeGreaterThan(2))
    expect(queryClient.getQueryState(tenantKeys.list)?.fetchStatus).toBe('fetching')
    expect(queryClient.getQueryData(tenantKeys.list)).toBeUndefined()
    expect(screen.queryByText(PROMPT)).not.toBeInTheDocument()
    expect(screen.getByText(/intentionally empty/)).toBeInTheDocument()
  })

  it('greets when the tenant list fails to load', async () => {
    server.use(http.get('/api/v1/tenants', () => fail('Something went wrong', 500)))
    renderDashboard()

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Welcome back, A')
    await waitFor(() => expect(queryClient.getQueryState(tenantKeys.list)?.status).toBe('error'))
    expect(screen.queryByText(PROMPT)).not.toBeInTheDocument()
  })
})
