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
import {
  fail,
  ok,
  TEST_INVITATION_TOKEN,
  testInvitationPreview,
  testUser,
} from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const TENANT = {
  id: 't1',
  name: 'Acme Corp',
  slug: 'acme',
  description: 'Anvils',
  logo: null,
  website: null,
  lifecycleState: 'active',
  deletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const ACCEPT_PATH = `/invitations/accept?token=${TEST_INVITATION_TOKEN}`
const INVALID = 'This invitation is invalid or has expired.'
const MISMATCH = 'This invitation was sent to a different email address.'
const UNVERIFIED = 'Verify your email address before accepting this invitation.'

function renderAt(path: string): AnyRouter {
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
  useAuthStore.setState({
    accessToken: null,
    user: null,
    isAuthenticated: false,
    isBootstrapped: false,
  })
  server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
}

/** Counts preview requests, answering the default fixture unless told otherwise. */
function countPreviews(answer = () => ok(testInvitationPreview, 'Invitation retrieved.')) {
  const calls = { count: 0 }
  server.use(
    http.post('/api/v1/invitations/preview', () => {
      calls.count += 1
      return answer()
    })
  )
  return calls
}

/** What the tenant route needs once accept has navigated there. */
function mockTenantRoute() {
  server.use(
    http.get('/api/v1/tenants', () =>
      ok([{ tenant: TENANT, role: 'editor' }], 'Tenants retrieved.')
    ),
    http.get('/api/v1/tenants/acme', () => ok(TENANT, 'Tenant retrieved.'))
  )
}

beforeEach(() => {
  resetSessionForTests()
  queryClient.clear()
})

describe('accept page: the link itself', () => {
  beforeEach(arriveSignedOut)

  it('says the link is incomplete when it has no token, and asks nothing', async () => {
    const previews = countPreviews()
    renderAt('/invitations/accept')

    expect(
      await screen.findByRole('heading', { name: 'This link is incomplete' })
    ).toBeInTheDocument()
    expect(previews.count).toBe(0)
  })

  it('treats a token the router reads as a number as missing, without crashing', async () => {
    // TanStack JSON-parses search values, so `?token=123` arrives as 123.
    const previews = countPreviews()
    renderAt('/invitations/accept?token=123')

    expect(
      await screen.findByRole('heading', { name: 'This link is incomplete' })
    ).toBeInTheDocument()
    expect(previews.count).toBe(0)
  })

  it('refuses a malformed token locally, without a request', async () => {
    const previews = countPreviews()
    renderAt('/invitations/accept?token=truncated')

    expect(
      await screen.findByRole('heading', { name: 'This invitation can’t be used' })
    ).toBeInTheDocument()
    expect(screen.getByText(INVALID)).toBeInTheDocument()
    expect(previews.count).toBe(0)
  })

  it('shows the server’s message for an invalid, expired or revoked invitation', async () => {
    countPreviews(() => fail(INVALID, 404, 'invitation_invalid'))
    renderAt(ACCEPT_PATH)

    expect(
      await screen.findByRole('heading', { name: 'This invitation can’t be used' })
    ).toBeInTheDocument()
    expect(screen.getByText(INVALID)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/')
  })

  it('does not call a failed request "invalid", and its retry asks again', async () => {
    let attempt = 0
    countPreviews(() => {
      attempt += 1
      // Two failures: the preview retries a non-404 once by itself.
      return attempt <= 2
        ? fail('Something went wrong.', 500)
        : ok(testInvitationPreview, 'Invitation retrieved.')
    })
    const user = userEvent.setup()
    renderAt(ACCEPT_PATH)

    const alert = await screen.findByRole('alert', {}, { timeout: 5000 })
    expect(alert).toHaveTextContent(/could not load this invitation/i)
    expect(screen.queryByText(INVALID)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/')

    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Join Acme Corp' })).toBeInTheDocument()
  })
})

describe('accept page, signed out', () => {
  beforeEach(arriveSignedOut)

  it('says who invited them, to what, and offers both ways in', async () => {
    renderAt(ACCEPT_PATH)

    expect(await screen.findByRole('heading', { name: 'Join Acme Corp' })).toBeInTheDocument()
    expect(
      screen.getByText('Ada Lovelace invited you to join Acme Corp as Editor.')
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Log in' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create account' })).toBeInTheDocument()
    // Nothing to accept until someone is signed in.
    expect(screen.queryByRole('button', { name: 'Accept invitation' })).not.toBeInTheDocument()
  })

  it('sends "Log in" to /login with this page as the redirect', async () => {
    const user = userEvent.setup()
    const router = renderAt(ACCEPT_PATH)

    await user.click(await screen.findByRole('link', { name: 'Log in' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
    expect(router.state.location.search).toEqual({ redirect: ACCEPT_PATH })
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('sends "Create account" to /register with the invited address prefilled', async () => {
    const user = userEvent.setup()
    const router = renderAt(ACCEPT_PATH)

    await user.click(await screen.findByRole('link', { name: 'Create account' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/register')
    })
    expect(router.state.location.search).toEqual({ email: testInvitationPreview.email })
    expect(await screen.findByLabelText('Email')).toHaveValue(testInvitationPreview.email)
  })
})

describe('accept page, signed in', () => {
  const realLocation = window.location

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
  })

  it('accepts for the invited account, toasts, and lands on the tenant', async () => {
    signIn()
    mockTenantRoute()
    let body: unknown
    let authorization: string | null = null
    server.use(
      http.post('/api/v1/invitations/accept', async ({ request }) => {
        body = await request.json()
        authorization = request.headers.get('authorization')
        return ok({ tenant: { name: 'Acme Corp', slug: 'acme' }, role: 'editor' }, 'Accepted.')
      })
    )
    const user = userEvent.setup()
    const router = renderAt(ACCEPT_PATH)

    // A signed-in visitor is not bounced: this route sits outside both guards.
    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }))

    expect(await screen.findByText('You joined Acme Corp.')).toBeInTheDocument()
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/tenants/acme')
    })
    expect(body).toEqual({ token: TEST_INVITATION_TOKEN })
    expect(authorization).toBe('Bearer access-token')
  })

  it('lands an existing member on the tenant, without claiming the invited role', async () => {
    signIn()
    mockTenantRoute()
    // Invited as editor, already an admin: the server keeps the admin role and
    // answers with it.
    server.use(
      http.post('/api/v1/invitations/accept', () =>
        ok({ tenant: { name: 'Acme Corp', slug: 'acme' }, role: 'admin' }, 'Accepted.')
      )
    )
    const user = userEvent.setup()
    const router = renderAt(ACCEPT_PATH)

    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }))

    expect(await screen.findByText('You joined Acme Corp.')).toBeInTheDocument()
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/tenants/acme')
    })
    expect(screen.queryByText(/as Editor/)).not.toBeInTheDocument()
  })

  it('matches the invited address regardless of case', async () => {
    signIn('A@B.COM')
    renderAt(ACCEPT_PATH)

    expect(await screen.findByRole('button', { name: 'Accept invitation' })).toBeInTheDocument()
  })

  it('names both addresses for the wrong account, and never tries to accept', async () => {
    signIn()
    let accepts = 0
    countPreviews(() =>
      ok({ ...testInvitationPreview, email: 'someone@else.com' }, 'Invitation retrieved.')
    )
    server.use(
      http.post('/api/v1/invitations/accept', () => {
        accepts += 1
        return ok({ tenant: testInvitationPreview.tenant, role: 'editor' }, 'Accepted.')
      })
    )
    renderAt(ACCEPT_PATH)

    expect(
      await screen.findByText(/This invitation was sent to someone@else\.com\./)
    ).toBeInTheDocument()
    expect(screen.getByText(/signed in as a@b\.com\./)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Accept invitation' })).not.toBeInTheDocument()
    expect(accepts).toBe(0)
  })

  it('signs the wrong account out through the normal path and returns to this page', async () => {
    signIn()
    countPreviews(() =>
      ok({ ...testInvitationPreview, email: 'someone@else.com' }, 'Invitation retrieved.')
    )
    let loggedOut = false
    server.use(
      http.post('/api/v1/auth/logout', () => {
        loggedOut = true
        return ok(null, 'Signed out.')
      })
    )
    const user = userEvent.setup()
    renderAt(ACCEPT_PATH)
    const signOut = await screen.findByRole('button', { name: 'Sign out' })

    // jsdom's `assign` cannot be spied on, so the whole `location` is replaced.
    const assign = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign },
    })
    await user.click(signOut)

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith(ACCEPT_PATH)
    })
    expect(loggedOut).toBe(true)
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('shows the unverified 403 with how to verify, and stays put', async () => {
    signIn()
    server.use(
      http.post('/api/v1/invitations/accept', () =>
        fail(UNVERIFIED, 403, 'invitation_email_unverified')
      )
    )
    const user = userEvent.setup()
    const router = renderAt(ACCEPT_PATH)

    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(UNVERIFIED)
    expect(alert).toHaveTextContent(/verification email/)
    expect(alert).not.toHaveTextContent(/different email address/)
    expect(router.state.location.pathname).toBe('/invitations/accept')
    // A 403 is not a session verdict.
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('shows the server’s mismatch 403 without telling a mismatched account to verify', async () => {
    // The addresses matched here, so the server's copy is the only account of it.
    signIn()
    server.use(
      http.post('/api/v1/invitations/accept', () =>
        fail(MISMATCH, 403, 'invitation_email_mismatch')
      )
    )
    const user = userEvent.setup()
    renderAt(ACCEPT_PATH)

    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(MISMATCH)
    expect(alert).not.toHaveTextContent(/verif/i)
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('switches to the invalid state when accept finds the invitation gone', async () => {
    signIn()
    server.use(
      http.post('/api/v1/invitations/accept', () => fail(INVALID, 404, 'invitation_invalid'))
    )
    const user = userEvent.setup()
    renderAt(ACCEPT_PATH)

    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }))

    expect(
      await screen.findByRole('heading', { name: 'This invitation can’t be used' })
    ).toBeInTheDocument()
    expect(screen.getByText(INVALID)).toBeInTheDocument()
  })

  it('toasts any other accept failure and keeps the button', async () => {
    signIn()
    server.use(
      http.post('/api/v1/invitations/accept', () =>
        fail('Too many attempts. Please try again later.', 429, 'RATE_LIMITED')
      )
    )
    const user = userEvent.setup()
    renderAt(ACCEPT_PATH)

    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }))

    expect(
      await screen.findByText('Too many attempts. Please try again later.')
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Accept invitation' })).toBeEnabled()
    })
  })
})
