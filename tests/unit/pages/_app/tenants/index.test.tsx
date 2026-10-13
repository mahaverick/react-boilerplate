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
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { API_PREFIX } from '@/constants/routes'
import { resetSessionForTests } from '@/http/session'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { latestFetchStream, MockFetchStream, stubStreamFetch } from '@/tests/mocks/fetch-stream'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

afterEach(() => {
  vi.restoreAllMocks()
})

const STREAM_URL = `${API_PREFIX}/notifications/stream`

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

/** Mounts the real route tree at `path` and returns the router. */
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
    expect(link).toHaveTextContent('Admin')
  })

  it('shows a suspended tenant with a badge, and not as a link', async () => {
    server.use(
      http.get('/api/v1/tenants', () =>
        ok([{ tenant: { ...TENANT, lifecycleState: 'suspended' }, role: 'admin' }], 'Tenants.')
      )
    )
    renderAppAt('/tenants')
    expect(await screen.findByText('Suspended')).toBeInTheDocument()
    expect(screen.getByText('Acme Corp')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Acme Corp/ })).not.toBeInTheDocument()
  })

  it('rejects a mixed-case slug while typing rather than lowercasing it', async () => {
    const user = userEvent.setup()
    renderAppAt('/tenants')

    await user.type(await screen.findByLabelText('Slug'), 'MyOrg')
    // The slug is a routing identifier: silently rewriting "MyOrg" to "myorg" would address a different tenant than the one typed.
    expect(await screen.findByText(/must be lowercase letters/i)).toBeInTheDocument()
  })

  it('does not blame a field the user has not reached', async () => {
    const user = userEvent.setup()
    renderAppAt('/tenants')

    await user.type(await screen.findByLabelText('Slug'), 'a')
    // Live validation is scoped to the field being edited: running the whole schema on change would put "Name is required." under an untouched Name on the first slug keystroke.
    expect(screen.queryByText('Name is required.')).not.toBeInTheDocument()
    expect(await screen.findByText(/at least 3 characters/i)).toBeInTheDocument()
  })

  it('still refuses to submit without a name', async () => {
    const user = userEvent.setup()
    renderAppAt('/tenants')

    await user.type(await screen.findByLabelText('Slug'), 'acme')
    await user.click(screen.getByRole('button', { name: 'Create tenant' }))
    // The whole schema has the last word on submit, so an untouched field is still checked.
    expect(await screen.findByText('Name is required.')).toBeInTheDocument()
  })

  it('rejects a reserved slug while typing', async () => {
    const user = userEvent.setup()
    renderAppAt('/tenants')

    await user.type(await screen.findByLabelText('Slug'), 'admin')
    expect(await screen.findByText('This slug is reserved and cannot be used.')).toBeInTheDocument()
  })

  /**
   * A failed load and an account that belongs to nothing both leave `data` undefined, so
   * without this the page would answer a 500 with "You do not belong to any tenants yet.
   * Create one below.", a claim about the account from a request that failed, inviting the
   * user to create a tenant they may already own.
   */
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
    // The schema trims, and the untouched description is absent rather than posted as '', which the API's `.min(1)` would refuse.
    expect(posted).toEqual({ name: 'Acme Corp', slug: 'acme' })
  })

  it('shows a refused create once, in the form, with no toast', async () => {
    const toastError = vi.spyOn(toast, 'error')
    server.use(http.post('/api/v1/tenants', () => fail('Something broke.', 500)))
    const user = userEvent.setup()
    renderAppAt('/tenants')

    await user.type(await screen.findByLabelText('Name'), 'Acme Corp')
    await user.type(screen.getByLabelText('Slug'), 'acme')
    await user.click(screen.getByRole('button', { name: 'Create tenant' }))

    const message = await screen.findByText('Something broke.')
    expect(message.closest('form')).not.toBeNull()
    expect(screen.getAllByText('Something broke.')).toHaveLength(1)
    expect(toastError).not.toHaveBeenCalled()
  })
})

/**
 * A session that dies on the SSE path while the tenant list is loading must move the user to
 * /login and, until that navigation completes, show the list's request as failed rather than
 * empty. A failed load and "belongs to no tenants" render identically, so without the
 * failed-request state a session that just died would invite the user to create an
 * organization they may already own.
 */
describe('a session that ends on the SSE path, while the tenant list is loading', () => {
  let assign: ReturnType<typeof vi.fn>

  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    MockFetchStream.instances = []
    stubStreamFetch(STREAM_URL)
    // jsdom's location is unforgeable, and a real `assign` would only log "Not implemented: navigation" and assert nothing.
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
    // Restores the `fetch` and `location` that existed before the stubs, not `undefined`, which the next file would inherit.
    vi.unstubAllGlobals()
  })

  /**
   * `_app`'s guard reads the list before the page mounts, so its first answer is a 500,
   * which the guard lets through, leaving the query with no data. The page's own read is
   * held open until the session has died, then answers a plain 401. Plain, not
   * ACCESS_TOKEN_EXPIRED, so the interceptor treats it as a verdict and does not retry.
   */
  it('redirects to /login and shows the failure, never the empty state', async () => {
    let release: (() => void) | undefined
    let attempt = 0
    server.use(
      http.get('/api/v1/tenants', async () => {
        attempt += 1
        if (attempt === 1) return fail('Something went wrong', 500)
        // Only the page's first read waits: the queryClient's `retry: 1` sends another, which must not hang the test.
        if (attempt === 2) await new Promise<void>((resolve) => (release = resolve))
        return fail('Unauthorized', 401)
      }),
      http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401))
    )

    renderAppAt('/tenants')
    await waitFor(() => expect(MockFetchStream.instances.length).toBeGreaterThan(0))
    await waitFor(() => expect(release).toBeDefined())

    latestFetchStream().fail()

    // The session ends and the user is moved, carrying where they were so signing back in returns them to /tenants.
    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false))
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(`/login?redirect=${encodeURIComponent('/tenants')}`)
    )

    // Until that navigation completes, the page being left says the request failed, not that this account owns nothing.
    release?.()
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load your tenants/i)
    expect(screen.queryByText(/do not belong to any tenants/i)).not.toBeInTheDocument()
  })
})
