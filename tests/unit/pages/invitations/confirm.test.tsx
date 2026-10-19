import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
  type RouterHistory,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHECK_INBOX_TITLE } from '@/components/features/auth/sign-in-link-form'
import { CONFIRM_DEAD_TITLE } from '@/components/features/invitations/invitation-parts'
import { resetSessionForTests } from '@/http/session'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { useMaintenanceModeStore } from '@/states/maintenance-mode.store'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { fail, ok, tenantDetail, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const TENANT = {
  id: TENANT_ID,
  name: 'Acme',
  slug: 'acme',
  description: 'Anvils',
  logo: null,
  website: null,
  lifecycleState: 'active',
  deletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const TOKEN = 'c'.repeat(43)
/** The address the link names. The server's `user.email` is deliberately cased apart from it. */
const LINK_EMAIL = 'ADA@example.com'
const SERVER_EMAIL = 'ada@example.com'
const CONFIRM_PATH = `/invitations/confirm?token=${TOKEN}&email=${encodeURIComponent(LINK_EMAIL)}`
const JOINED = `You joined Acme as ${SERVER_EMAIL}.`
const DEAD_TITLE = CONFIRM_DEAD_TITLE
const DEAD_BODY =
  'Open your invitation email and select Join again to get a new link. If the invitation expired, ask the team for a new invite.'
const INCOMPLETE_TITLE = 'This link is incomplete'
const INVALID = 'This invitation is invalid or has expired.'

/** Mounts the real route tree at `path`, under StrictMode as dev runs it, and returns the router. */
function renderAt(path: string): AnyRouter {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
    ...ROUTER_DEFAULTS,
  })
  render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>
    </StrictMode>
  )
  return router as AnyRouter
}

/** A signed-in, bootstrapped session whose address is `email`. */
function signIn(email = testUser.email) {
  useAuthStore.setState({
    accessToken: 'access-token',
    user: { ...testUser, email },
    isAuthenticated: true,
    isBootstrapped: true,
  })
}

/** No refresh cookie, so the root's bootstrap settles signed out. */
function arriveSignedOut() {
  server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
}

/** What a recorded request carried. */
interface Seen {
  body: unknown
  authorization: string | null
}

/** Records every confirm post; each answers with the next of `answers`, the last one repeating. */
function serveConfirm(...answers: (() => Response | Promise<Response>)[]): Seen[] {
  const seen: Seen[] = []
  server.use(
    http.post('/api/v1/invitations/confirm', async ({ request }) => {
      const answer = answers[Math.min(seen.length, answers.length - 1)]
      seen.push({ body: await request.json(), authorization: request.headers.get('authorization') })
      return answer?.() ?? fail('No answer', 500)
    })
  )
  return seen
}

/** The confirm `200`: a session for the server's own address, joined to Acme. */
function joined() {
  return () =>
    ok(
      {
        user: { ...testUser, email: SERVER_EMAIL },
        accessToken: 'confirm-token',
        isNewUser: false,
        tenant: { name: 'Acme', slug: 'acme' },
        role: 'editor',
      },
      'Invitation accepted.'
    )
}

/** An answer that never arrives, so a test can grade the frame shown while it runs. */
function held() {
  return async () => {
    await delay('infinite')
    return ok(null)
  }
}

/** A 429 that says to wait `seconds`. */
function rateLimited(seconds: number) {
  return () => {
    const response = fail('Too many attempts. Please try again later.', 429)
    response.headers.set('Retry-After', String(seconds))
    return response
  }
}

/** What the tenant route needs once the page has navigated there. */
function mockTenantRoute() {
  server.use(
    http.get('/api/v1/tenants', () =>
      ok(
        listPage([
          {
            tenant: TENANT,
            role: 'editor',
            isPlatform: false,
            joinedAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
        'Tenants retrieved.'
      )
    ),
    http.get('/api/v1/tenants/acme', () => ok(tenantDetail(TENANT, 'editor'), 'Tenant retrieved.'))
  )
}

/** Waits for the landing on the joined tenant, which replaced the token page in history. */
async function expectLandedInTenant(router: AnyRouter) {
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/tenants/acme')
  })
  expect((router.history as RouterHistory).length).toBe(1)
}

const realLocation = window.location

/** Replaces `window.location` with a copy whose `assign` is a spy; jsdom's own cannot be spied on. */
function stubAssign() {
  const assign = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...realLocation, assign },
  })
  return assign
}

beforeEach(() => {
  resetSessionForTests()
  queryClient.clear()
  useMaintenanceModeStore.setState({ mode: 'off', message: null, since: null })
  useAuthStore.setState({
    accessToken: null,
    user: null,
    isAuthenticated: false,
    isBootstrapped: false,
  })
})

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
})

describe('confirm page: the link itself', () => {
  beforeEach(arriveSignedOut)

  it.each([
    ['no token', `/invitations/confirm?email=${encodeURIComponent(LINK_EMAIL)}`],
    ['no email', `/invitations/confirm?token=${TOKEN}`],
    ['a blank email', `/invitations/confirm?token=${TOKEN}&email=%20`],
    ['nothing at all', '/invitations/confirm'],
  ])('shows the incomplete state for %s, with no call', async (_case, path) => {
    const confirms = serveConfirm(joined())
    renderAt(path)

    expect(await screen.findByRole('heading', { level: 1, name: INCOMPLETE_TITLE })).toBeVisible()
    expect(
      screen.getByText(
        'The link is missing part of its address. Open the most recent email from us and use its link.'
      )
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/')
    expect(confirms).toHaveLength(0)
  })

  it('shows the dead-link state for a malformed token, with no call', async () => {
    const confirms = serveConfirm(joined())
    renderAt(`/invitations/confirm?token=short&email=${encodeURIComponent(LINK_EMAIL)}`)

    expect(await screen.findByRole('heading', { level: 1, name: DEAD_TITLE })).toBeVisible()
    expect(screen.getByText(DEAD_BODY)).toBeVisible()
    expect(screen.getByLabelText('Email')).toHaveValue(LINK_EMAIL)
    expect(confirms).toHaveLength(0)
  })
})

describe('confirm page, signed out', () => {
  beforeEach(arriveSignedOut)

  it('joins a signed-out visitor in one load and lands in the tenant with the toast', async () => {
    mockTenantRoute()
    const confirms = serveConfirm(joined())
    const router = renderAt(CONFIRM_PATH)

    await expectLandedInTenant(router)
    expect(await screen.findAllByText(JOINED)).toHaveLength(1)
    expect(screen.getByText(JOINED).closest('.ph-sensitive.ph-mask')).not.toBeNull()
    expect(useAuthStore.getState().user?.email).toBe(SERVER_EMAIL)
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(confirms).toEqual([{ body: { token: TOKEN, email: LINK_EMAIL }, authorization: null }])
  })

  it('shows Joining your team and the link’s address while it joins', async () => {
    serveConfirm(held())
    renderAt(CONFIRM_PATH)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Joining your team' })
    ).toBeVisible()
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Joining your team…')
    expect(status).toHaveTextContent(`This link is for ${LINK_EMAIL}.`)
    expect(within(status).getByText(LINK_EMAIL)).toHaveClass('ph-sensitive', 'ph-mask')
  })

  it('posts the link exactly once under StrictMode', async () => {
    const confirms = serveConfirm(held())
    renderAt(CONFIRM_PATH)

    await screen.findByRole('heading', { level: 1, name: 'Joining your team' })
    await waitFor(() => expect(confirms).toHaveLength(1))
    // StrictMode's second effect run happens at mount; the barrier is the frame staying put.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Joining your team')
    expect(confirms).toHaveLength(1)
  })

  it('sends the link’s email, and omits a blank one', async () => {
    const confirms = serveConfirm(held())
    renderAt(`/invitations/confirm?token=${TOKEN}&email=${encodeURIComponent('  ada@x.test ')}`)

    await waitFor(() => expect(confirms).toHaveLength(1))
    expect(confirms[0]?.body).toEqual({ token: TOKEN, email: 'ada@x.test' })
  })

  it('names the server’s address after success, not the link’s', async () => {
    mockTenantRoute()
    serveConfirm(joined())
    renderAt(`/invitations/confirm?token=${TOKEN}&email=${encodeURIComponent('mallory@evil.test')}`)

    expect(await screen.findByText(JOINED)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText(/mallory@evil\.test/)).not.toBeInTheDocument()
    })
  })

  it('drops the token from the URL after the outcome', async () => {
    serveConfirm(() => fail(INVALID, 404, 'invitation_invalid'))
    const router = renderAt(CONFIRM_PATH)

    expect(await screen.findByRole('heading', { level: 1, name: DEAD_TITLE })).toBeVisible()
    await waitFor(() => {
      expect(router.state.location.searchStr).not.toContain('token=')
    })
    expect(router.state.location.pathname).toBe('/invitations/confirm')
    expect((router.history as RouterHistory).length).toBe(1)
    // The page keeps its outcome; it does not turn into the incomplete link.
    expect(screen.getByRole('heading', { level: 1, name: DEAD_TITLE })).toBeVisible()
  })

  it('shows the dead-link state on 404, with SignInLinkForm prefilled from the link’s email', async () => {
    serveConfirm(() => fail(INVALID, 404, 'invitation_invalid'))
    const requests: unknown[] = []
    server.use(
      http.post('/api/v1/auth/link/request', async ({ request }) => {
        requests.push(await request.json())
        return ok(null, 'Check your email.', 202)
      })
    )
    const user = userEvent.setup()
    renderAt(CONFIRM_PATH)

    expect(await screen.findByRole('heading', { level: 1, name: DEAD_TITLE })).toBeVisible()
    expect(screen.getByText(DEAD_BODY)).toBeVisible()
    expect(screen.getByText('Or sign in:')).toBeVisible()
    expect(screen.getByLabelText('Email')).toHaveValue(LINK_EMAIL)
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toBeVisible()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))
    expect(await screen.findByRole('heading', { level: 1, name: CHECK_INBOX_TITLE })).toBeVisible()
    expect(requests).toEqual([{ email: SERVER_EMAIL, app: 'web' }])
  })

  it('lets the maintenance page cover a 503 MAINTENANCE_MODE, and never calls the link dead', async () => {
    const since = '2026-10-20T08:00:00.000Z'
    server.use(
      http.get('/api/v1/status/maintenance', () =>
        ok({ mode: 'full', message: null, since }, 'Maintenance status retrieved.')
      )
    )
    const confirms = serveConfirm(() =>
      HttpResponse.json(
        {
          success: false,
          message: 'Down for maintenance.',
          statusCode: 503,
          code: 'MAINTENANCE_MODE',
        },
        { status: 503 }
      )
    )
    renderAt(CONFIRM_PATH)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'We’ll be back soon' })
    ).toBeVisible()
    expect(confirms).toHaveLength(1)
    expect(screen.queryByText(DEAD_TITLE)).not.toBeInTheDocument()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it.each([
    [
      '503 READ_ONLY_MODE',
      () => fail('The service is read-only for maintenance.', 503, 'READ_ONLY_MODE'),
      'Changes are paused during maintenance.',
    ],
    ['429', rateLimited(42), 'Too many attempts. Try again in 42 seconds.'],
    ['403', () => fail('Origin not allowed.', 403), 'Origin not allowed.'],
    ['500', () => fail('Something broke.', 500), 'Something broke.'],
    [
      'a network error',
      () => HttpResponse.error(),
      "We couldn't reach the server. Check your connection, then try again.",
    ],
  ])('offers Try again on %s, and Try again posts again', async (_case, failure, message) => {
    mockTenantRoute()
    const confirms = serveConfirm(failure, joined())
    const user = userEvent.setup()
    const router = renderAt(CONFIRM_PATH)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'We couldn’t add you to your team' })
    ).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByText(DEAD_TITLE)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    await expectLandedInTenant(router)
    expect(confirms).toHaveLength(2)
    expect(confirms[1]?.body).toEqual({ token: TOKEN, email: LINK_EMAIL })
  })
})

describe('confirm page, signed in', () => {
  it('joins a signed-in user whose address matches (case-insensitive)', async () => {
    signIn(SERVER_EMAIL)
    mockTenantRoute()
    const confirms = serveConfirm(joined())
    const router = renderAt(CONFIRM_PATH)

    await expectLandedInTenant(router)
    expect(await screen.findAllByText(JOINED)).toHaveLength(1)
    // The server replaces the session; the old bearer is never sent.
    expect(confirms).toEqual([{ body: { token: TOKEN, email: LINK_EMAIL }, authorization: null }])
    expect(useAuthStore.getState().accessToken).toBe('confirm-token')
  })

  it('asks a different signed-in person before switching and spends nothing', async () => {
    signIn('someone@else.test')
    const confirms = serveConfirm(joined())
    let logouts = 0
    server.use(
      http.post('/api/v1/auth/logout', () => {
        logouts += 1
        return ok(null, 'Signed out.')
      })
    )
    const assign = stubAssign()
    const user = userEvent.setup()
    renderAt(CONFIRM_PATH)

    expect(await screen.findByRole('heading', { level: 1, name: 'Join your team' })).toBeVisible()
    expect(screen.getByText(/This invitation is for/)).toHaveTextContent(
      `This invitation is for ${LINK_EMAIL}. You're signed in as someone@else.test.`
    )
    expect(confirms).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: `Continue as ${LINK_EMAIL}` }))

    await waitFor(() => expect(assign).toHaveBeenCalledOnce())
    expect(assign).toHaveBeenCalledWith(CONFIRM_PATH)
    expect(logouts).toBe(1)
    expect(confirms).toHaveLength(0)
  })

  it('goes to the dashboard on Cancel, still signed in, and spends nothing', async () => {
    signIn('someone@else.test')
    const confirms = serveConfirm(joined())
    const user = userEvent.setup()
    const router = renderAt(CONFIRM_PATH)

    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
    expect(useAuthStore.getState().user?.email).toBe('someone@else.test')
    expect(confirms).toHaveLength(0)
  })

  it('offers the dashboard, not a sign-in form, on a dead link while signed in', async () => {
    signIn(SERVER_EMAIL)
    serveConfirm(() => fail(INVALID, 404, 'invitation_invalid'))
    renderAt(CONFIRM_PATH)

    expect(await screen.findByRole('heading', { level: 1, name: DEAD_TITLE })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Go to the dashboard' })).toHaveAttribute(
      'href',
      '/dashboard'
    )
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
    expect(useAuthStore.getState().user?.email).toBe(SERVER_EMAIL)
  })
})
