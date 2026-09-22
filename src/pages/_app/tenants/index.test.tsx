import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { latestEventSource, MockEventSource } from '@/tests/mocks/event-source'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const TENANT = {
  id: 't1',
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

function renderAppAt(path: string): AnyRouter {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return router as AnyRouter
}

describe('tenants list', () => {
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

  it('shows an empty state when the account belongs to no tenants', async () => {
    renderAppAt('/tenants')
    expect(await screen.findByText(/do not belong to any tenants/i)).toBeInTheDocument()
  })

  it('lists each tenant as a link carrying its role', async () => {
    server.use(
      http.get('/api/v1/tenants', () => ok([{ tenant: TENANT, role: 'admin' }], 'Tenants.'))
    )
    renderAppAt('/tenants')

    const link = await screen.findByRole('link', { name: /Acme Corp/ })
    expect(link).toHaveAttribute('href', '/tenants/acme')
    // The role in words, inside the row itself.
    expect(link).toHaveTextContent('Admin')
  })

  it('rejects a mixed-case slug while typing rather than lowercasing it', async () => {
    const user = userEvent.setup()
    renderAppAt('/tenants')

    await user.type(await screen.findByLabelText('Slug'), 'MyOrg')
    // The slug is a routing identifier: silently rewriting "MyOrg" to "myorg"
    // would address a different tenant than the one the user typed.
    expect(await screen.findByText(/must be lowercase letters/i)).toBeInTheDocument()
  })

  it('does not blame a field the user has not reached', async () => {
    const user = userEvent.setup()
    renderAppAt('/tenants')

    await user.type(await screen.findByLabelText('Slug'), 'a')
    // Live validation is scoped to the field being edited. Running the whole
    // schema on change put "Name is required." under an untouched Name as
    // soon as the first character of the slug was typed.
    expect(screen.queryByText('Name is required.')).not.toBeInTheDocument()
    // And the slug's own live feedback still works: 'a' is too short.
    expect(await screen.findByText(/at least 3 characters/i)).toBeInTheDocument()
  })

  it('still refuses to submit without a name', async () => {
    const user = userEvent.setup()
    renderAppAt('/tenants')

    await user.type(await screen.findByLabelText('Slug'), 'acme')
    await user.click(screen.getByRole('button', { name: 'Create tenant' }))
    // The whole schema still has the last word on submit — nothing escapes
    // by being untouched.
    expect(await screen.findByText('Name is required.')).toBeInTheDocument()
  })

  it('rejects a reserved slug while typing', async () => {
    const user = userEvent.setup()
    renderAppAt('/tenants')

    await user.type(await screen.findByLabelText('Slug'), 'admin')
    expect(await screen.findByText('This slug is reserved and cannot be used.')).toBeInTheDocument()
  })

  // A FAILED load and an account that belongs to nothing render the same
  // shape — `data` is undefined in both — so the page used to answer a 500
  // with "You do not belong to any tenants yet. Create one below.", which is
  // a claim about the account made on the strength of a request that failed,
  // and an invitation to create a tenant the user may already own.
  it('shows a retry, not the empty state, when the list fails to load', async () => {
    server.use(http.get('/api/v1/tenants', () => fail('Something went wrong', 500)))
    renderAppAt('/tenants')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not load your tenants/i)
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByText(/do not belong to any tenants/i)).not.toBeInTheDocument()
  })

  it('retries the list from that control, and renders it when it comes back', async () => {
    let failNext = true
    server.use(
      http.get('/api/v1/tenants', () =>
        failNext
          ? fail('Something went wrong', 500)
          : ok([{ tenant: TENANT, role: 'owner' }], 'Tenants retrieved.')
      )
    )
    const user = userEvent.setup()
    renderAppAt('/tenants')

    const alert = await screen.findByRole('alert')
    failNext = false
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('link', { name: /Acme Corp/ })).toBeInTheDocument()
  })

  it('creates a tenant, sending the parsed body', async () => {
    let posted: unknown = null
    server.use(
      http.post('/api/v1/tenants', async ({ request }) => {
        posted = await request.json()
        return ok(TENANT, 'Tenant created.', 201)
      })
    )
    const user = userEvent.setup()
    renderAppAt('/tenants')

    await user.type(await screen.findByLabelText('Name'), '  Acme Corp  ')
    await user.type(screen.getByLabelText('Slug'), 'acme')
    await user.click(screen.getByRole('button', { name: 'Create tenant' }))

    await waitFor(() => {
      expect(posted).not.toBeNull()
    })
    // Trimmed by the schema, and the untouched description is ABSENT rather
    // than posted as '' — which the API's own `.min(1)` would refuse.
    expect(posted).toEqual({ name: 'Acme Corp', slug: 'acme' })
  })
})

/**
 * Where findings 1 and 2 meet.
 *
 * Neither bug is this one on its own. The SSE path ended the session without
 * moving anybody, and the list answered a failed load with its empty state —
 * and composed, they put a user whose session has just died in front of a
 * page telling them they belong to no organizations and offering to create
 * one. Two separately-plausible behaviours producing a screen that lies.
 *
 * This is why the fixes ship together, and it is what this test pins.
 */
describe('a session that ends on the SSE path, while the tenant list is loading', () => {
  let assign: ReturnType<typeof vi.fn>

  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    MockEventSource.instances = []
    vi.stubGlobal('EventSource', MockEventSource)
    // jsdom's location is unforgeable, and a real `assign` here would only
    // log "Not implemented: navigation" — asserting nothing.
    assign = vi.fn()
    vi.stubGlobal('location', {
      ...window.location,
      href: `${window.location.origin}/tenants`,
      pathname: '/tenants',
      search: '',
      hash: '',
      assign,
    })
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
  })

  afterEach(() => {
    // Puts back the idle EventSource stub from tests/setup.ts, and the real
    // location — NOT `undefined`, which the next file would inherit.
    vi.unstubAllGlobals()
  })

  it('redirects to /login and shows the failure, never the empty state', async () => {
    // The list is held open until the session has died, then answers the
    // plain 401 a request with no Authorization header gets. Plain, not
    // ACCESS_TOKEN_EXPIRED: the interceptor correctly refuses to retry it,
    // which is exactly what leaves the query with no data.
    let release: (() => void) | undefined
    let attempt = 0
    server.use(
      http.get('/api/v1/tenants', async () => {
        attempt += 1
        // Only the first attempt waits; the queryClient's `retry: 1` sends a
        // second, and it must not hang the test.
        if (attempt === 1) await new Promise<void>((resolve) => (release = resolve))
        return fail('Unauthorized', 401)
      }),
      http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401))
    )

    renderAppAt('/tenants')
    // The shell is up and the stream is connected before anything else.
    await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0))
    await waitFor(() => expect(release).toBeDefined())

    // The stream drops, the reconnect refreshes, and the refresh is judged.
    latestEventSource().onerror?.(new Event('error'))

    // Finding 1: the session ends AND the user is actually moved, carrying
    // where they were so signing back in returns them to /tenants.
    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false))
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(`/login?redirect=${encodeURIComponent('/tenants')}`)
    )

    // Finding 2: and until that navigation completes, the page it is leaving
    // says the request failed — not that this account owns nothing.
    release?.()
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load your tenants/i)
    expect(screen.queryByText(/do not belong to any tenants/i)).not.toBeInTheDocument()
  })
})
