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
import { resetSessionForTests } from '@/http/session'
import { invitationKeys } from '@/queries/invitation.queries'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { useMaintenanceModeStore } from '@/states/maintenance-mode.store'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import {
  fail,
  ok,
  tenantDetail,
  TEST_INVITATION_TOKEN,
  testInvitationPreview,
  testUser,
} from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const TENANT = {
  id: TENANT_ID,
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
const DEAD_TITLE = 'This invitation can’t be used'
const ASK_THE_TEAM = 'Ask the team for a new invite.'
/** The toast names the account now signed in: the test user, unless a test says otherwise. */
const JOINED = `You joined Acme Corp as ${testUser.email}.`
const ALREADY_JOINED = `You've already joined Acme Corp as ${testUser.email}.`
const OTHER_EMAIL = 'someone@else.com'

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

/** Counts preview requests, answering the default fixture unless told otherwise. */
function servePreview(answer = () => ok(testInvitationPreview, 'Invitation retrieved.')) {
  const calls = { count: 0 }
  server.use(
    http.post('/api/v1/invitations/preview', () => {
      calls.count += 1
      return answer()
    })
  )
  return calls
}

/** A preview addressed to someone other than the signed-in test user. */
function previewForSomeoneElse() {
  return servePreview(() =>
    ok({ ...testInvitationPreview, email: OTHER_EMAIL }, 'Invitation retrieved.')
  )
}

/** What a recorded request carried. */
interface Seen {
  body: unknown
  authorization: string | null
}

/**
 * Records every post to `path`; each answers with the next of `answers`, the last one
 * repeating. Pushes, never spreads, so two concurrent posts both land in the list.
 */
function serve(path: string, ...answers: (() => Response | Promise<Response>)[]): Seen[] {
  const seen: Seen[] = []
  server.use(
    http.post(path, async ({ request }) => {
      const answer = answers[Math.min(seen.length, answers.length - 1)]
      seen.push({ body: await request.json(), authorization: request.headers.get('authorization') })
      return answer?.() ?? fail('No answer', 500)
    })
  )
  return seen
}

/** Records the signed-out one-click verifies. */
function serveVerify(...answers: (() => Response | Promise<Response>)[]): Seen[] {
  return serve('/api/v1/invitations/verify', ...answers)
}

/** Records the signed-in accepts. */
function serveAccept(...answers: (() => Response | Promise<Response>)[]): Seen[] {
  return serve('/api/v1/invitations/accept', ...answers)
}

/** A verify that signs the invitee in and joins them. */
function verified(extra: { isNewUser?: boolean } = {}) {
  return () =>
    ok(
      {
        user: testUser,
        accessToken: 'invitation-token',
        isNewUser: false,
        tenant: { name: 'Acme Corp', slug: 'acme' },
        role: 'editor',
        ...extra,
      },
      'Invitation accepted.'
    )
}

/** An accept that joined, or found the caller a member already. */
function accepted(alreadyMember = false) {
  return () =>
    ok(
      { tenant: { name: 'Acme Corp', slug: 'acme' }, role: 'editor', alreadyMember },
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

describe('accept page: the link itself', () => {
  beforeEach(arriveSignedOut)

  it('says the link is incomplete when it has no token, and asks nothing', async () => {
    const previews = servePreview()
    renderAt('/invitations/accept')

    expect(
      await screen.findByRole('heading', { name: 'This link is incomplete' })
    ).toBeInTheDocument()
    expect(previews.count).toBe(0)
  })

  it('treats a token the router reads as a number as missing, without crashing', async () => {
    // TanStack JSON-parses search values, so `?token=123` arrives as 123.
    const previews = servePreview()
    renderAt('/invitations/accept?token=123')

    expect(
      await screen.findByRole('heading', { name: 'This link is incomplete' })
    ).toBeInTheDocument()
    expect(previews.count).toBe(0)
  })

  it('refuses a malformed token locally as the dead invitation, without a request', async () => {
    const previews = servePreview()
    const verifies = serveVerify(verified())
    renderAt('/invitations/accept?token=truncated')

    expect(await screen.findByRole('heading', { level: 1, name: DEAD_TITLE })).toBeVisible()
    expect(screen.getByText(ASK_THE_TEAM)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Email me a sign-in link' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/')
    expect(previews.count).toBe(0)
    expect(verifies).toHaveLength(0)
  })

  it('holds the loaded card’s height while the preview loads: a sentence, two buttons and a hint', async () => {
    server.use(http.post('/api/v1/invitations/preview', held()))
    renderAt(ACCEPT_PATH)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Checking your invitation' })
    ).toBeVisible()
    const card = screen.getByRole('heading', { level: 1 }).closest('[data-slot="card"]')
    expect(card?.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(4)
  })

  it('does not call a failed request "invalid", and its retry asks again', async () => {
    let attempt = 0
    servePreview(() => {
      attempt += 1
      // Two failures, because the preview retries a non-404 once by itself.
      return attempt <= 2
        ? fail('Something went wrong.', 500)
        : ok(testInvitationPreview, 'Invitation retrieved.')
    })
    serveVerify(held())
    const user = userEvent.setup()
    renderAt(ACCEPT_PATH)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not load this invitation/i)
    expect(screen.queryByText(DEAD_TITLE)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/')

    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Joining Acme Corp' })
    ).toBeVisible()
  })
})

describe('accept page, signed out', () => {
  beforeEach(arriveSignedOut)

  it('joins a signed-out invitee in one load and lands in the tenant with the toast', async () => {
    mockTenantRoute()
    const verifies = serveVerify(verified())
    const accepts = serveAccept(accepted())
    const router = renderAt(ACCEPT_PATH)

    await expectLandedInTenant(router)
    expect(await screen.findAllByText(JOINED)).toHaveLength(1)
    // The toast names the account, so its root must mask it for analytics.
    expect(screen.getByText(JOINED).closest('.ph-sensitive.ph-mask')).not.toBeNull()
    expect(useAuthStore.getState().user).toEqual(testUser)
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(verifies).toEqual([{ body: { token: TEST_INVITATION_TOKEN }, authorization: null }])
    // The verify's own sign-in must not turn the page into its signed-in row, which would accept again.
    expect(accepts).toHaveLength(0)
  })

  it('lands a new account on the tenant too, not on /welcome', async () => {
    mockTenantRoute()
    serveVerify(verified({ isNewUser: true }))
    const router = renderAt(ACCEPT_PATH)

    await expectLandedInTenant(router)
    expect(await screen.findByText(JOINED)).toBeInTheDocument()
  })

  it('names the workspace, the inviter and the invited address while it joins', async () => {
    serveVerify(held())
    renderAt(ACCEPT_PATH)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Joining Acme Corp' })
    ).toBeVisible()
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(`Joining Acme Corp as ${testUser.email}…`)
    expect(within(status).getByText(testUser.email)).toHaveClass('ph-sensitive', 'ph-mask')
    expect(screen.getByText(/invited you to join/)).toHaveTextContent(
      'Ada Lovelace invited you to join Acme Corp as Editor.'
    )
    expect(screen.getByText('Ada Lovelace')).toHaveClass('ph-sensitive', 'ph-mask')
  })

  it('names the server’s invited address while joining, not an email in the URL', async () => {
    serveVerify(held())
    renderAt(`${ACCEPT_PATH}&email=${encodeURIComponent('mallory@evil.test')}`)

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(`Joining Acme Corp as ${testUser.email}…`)
    expect(screen.queryByText(/mallory@evil\.test/)).not.toBeInTheDocument()
  })

  it('names the account the verify signed in, from its answer, not an email in the URL', async () => {
    mockTenantRoute()
    const ada = { ...testUser, email: 'ada@acme.test' }
    serveVerify(() =>
      ok(
        {
          user: ada,
          accessToken: 'invitation-token',
          isNewUser: false,
          tenant: { name: 'Acme Corp', slug: 'acme' },
          role: 'editor',
        },
        'Invitation accepted.'
      )
    )
    const router = renderAt(`${ACCEPT_PATH}&email=${encodeURIComponent('mallory@evil.test')}`)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/tenants/acme')
    })
    expect(await screen.findByText('You joined Acme Corp as ada@acme.test.')).toBeInTheDocument()
    expect(screen.queryByText(/mallory@evil\.test/)).not.toBeInTheDocument()
  })

  it('names the inviter on a dead invitation once the preview loaded', async () => {
    serveVerify(() => fail(INVALID, 404, 'invitation_invalid'))
    renderAt(ACCEPT_PATH)

    expect(await screen.findByRole('heading', { level: 1, name: DEAD_TITLE })).toBeVisible()
    expect(screen.getByText(/for a new invite/)).toHaveTextContent(
      'Ask Ada Lovelace for a new invite.'
    )
    expect(screen.getByText('Ada Lovelace')).toHaveClass('ph-sensitive', 'ph-mask')
    expect(screen.getByText('Or sign in:')).toBeVisible()
    expect(screen.getByLabelText('Email')).toHaveValue('')
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toBeVisible()
    expect(screen.queryByText(/@/)).not.toBeInTheDocument()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('asks the team when the inviter has no name on file', async () => {
    servePreview(() => ok({ ...testInvitationPreview, invitedBy: null }, 'Invitation retrieved.'))
    serveVerify(() => fail(INVALID, 404, 'invitation_invalid'))
    renderAt(ACCEPT_PATH)

    expect(await screen.findByRole('heading', { level: 1, name: DEAD_TITLE })).toBeVisible()
    expect(screen.getByText(ASK_THE_TEAM)).toBeVisible()
  })

  it('sends a sign-in link from the dead invitation, with no redirect, and keeps the form', async () => {
    serveVerify(() => fail(INVALID, 404, 'invitation_invalid'))
    const requests = serve('/api/v1/auth/link/request', () => ok(null, 'Check your email.', 202))
    const user = userEvent.setup()
    renderAt(ACCEPT_PATH)

    await user.type(await screen.findByLabelText('Email'), 'ada@example.test')
    await user.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))

    expect(await screen.findByRole('heading', { level: 1, name: CHECK_INBOX_TITLE })).toBeVisible()
    expect(screen.queryByText('Or sign in:')).not.toBeInTheDocument()
    expect(screen.queryByText(/for a new invite/)).not.toBeInTheDocument()
    expect(requests).toHaveLength(1)
    expect(requests[0]?.body).toEqual({ email: 'ada@example.test', app: 'web' })
    // A form remounted by the switch to "Check your inbox" would lose its deadline and offer "Resend link".
    const resend = await screen.findByRole('button', { name: /^Resend in 1:00$|^Resend in 0:5\d$/ })
    await waitFor(() => {
      expect(resend).toHaveAccessibleName(/^Resend in 0:5\d$/)
    })
    expect(screen.getByRole('button', { name: /^Resend in/ })).toBe(resend)
  })

  it.each([
    [
      'a READ_ONLY_MODE 503',
      () => fail('The service is read-only for maintenance.', 503, 'READ_ONLY_MODE'),
      'Changes are paused during maintenance.',
    ],
    [
      'a 429',
      () => {
        const response = fail('Too many attempts. Please try again later.', 429)
        response.headers.set('Retry-After', '42')
        return response
      },
      'Too many attempts. Try again in 42 seconds.',
    ],
    [
      'a network error',
      () => HttpResponse.error(),
      "We couldn't reach the server. Check your connection, then try again.",
    ],
  ])('offers Try again on %s, and the retry joins', async (_name, failure, message) => {
    mockTenantRoute()
    const verifies = serveVerify(failure, verified())
    const user = userEvent.setup()
    const router = renderAt(ACCEPT_PATH)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'We couldn’t add you to Acme Corp' })
    ).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByText(DEAD_TITLE)).not.toBeInTheDocument()
    expect(verifies).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    await expectLandedInTenant(router)
    expect(verifies).toHaveLength(2)
    expect(await screen.findAllByText(JOINED)).toHaveLength(1)
  })

  it('offers Try again on a READ_ONLY_MODE 503', async () => {
    serveVerify(() => fail('The service is read-only for maintenance.', 503, 'READ_ONLY_MODE'))
    renderAt(ACCEPT_PATH)

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('Changes are paused during maintenance.')
    expect(
      screen.queryByRole('button', { name: 'Email me a sign-in link' })
    ).not.toBeInTheDocument()
  })

  it('moves a retry that finds the invitation gone to the dead invitation', async () => {
    serveVerify(
      () => fail('Server error.', 500),
      () => fail(INVALID, 404, 'invitation_invalid')
    )
    const user = userEvent.setup()
    renderAt(ACCEPT_PATH)

    await user.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { level: 1, name: DEAD_TITLE })).toBeVisible()
    expect(screen.getByText(/for a new invite/)).toHaveTextContent(
      'Ask Ada Lovelace for a new invite.'
    )
  })
})

describe('accept page, signed in', () => {
  it('joins a signed-in invitee without a click', async () => {
    signIn()
    mockTenantRoute()
    const accepts = serveAccept(accepted())
    const verifies = serveVerify(verified())
    const router = renderAt(ACCEPT_PATH)

    await expectLandedInTenant(router)
    expect(await screen.findAllByText(JOINED)).toHaveLength(1)
    expect(accepts).toEqual([
      { body: { token: TEST_INVITATION_TOKEN }, authorization: 'Bearer access-token' },
    ])
    expect(verifies).toHaveLength(0)
    expect(useAuthStore.getState().user?.email).toBe(testUser.email)
  })

  it('shows the joining frame, naming the invited address, while the accept runs', async () => {
    signIn()
    serveAccept(held())
    renderAt(ACCEPT_PATH)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Joining Acme Corp' })
    ).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent(`Joining Acme Corp as ${testUser.email}…`)
  })

  it('matches the invited address regardless of case', async () => {
    signIn('A@B.COM')
    mockTenantRoute()
    const accepts = serveAccept(accepted())
    const router = renderAt(ACCEPT_PATH)

    await expectLandedInTenant(router)
    expect(accepts).toHaveLength(1)
  })

  it('tells an existing member they had joined already', async () => {
    signIn()
    mockTenantRoute()
    serveAccept(accepted(true))
    const router = renderAt(ACCEPT_PATH)

    await expectLandedInTenant(router)
    expect(await screen.findAllByText(ALREADY_JOINED)).toHaveLength(1)
    expect(screen.queryByText(JOINED)).not.toBeInTheDocument()
  })

  it('asks a different signed-in person before switching and spends nothing', async () => {
    signIn()
    previewForSomeoneElse()
    const accepts = serveAccept(accepted())
    const verifies = serveVerify(verified())
    let logouts = 0
    server.use(
      http.post('/api/v1/auth/logout', () => {
        logouts += 1
        return ok(null, 'Signed out.')
      })
    )
    const user = userEvent.setup()
    renderAt(ACCEPT_PATH)

    expect(await screen.findByRole('heading', { level: 1, name: 'Join Acme Corp' })).toBeVisible()
    expect(screen.getByText(/This invitation is for/)).toHaveTextContent(
      `This invitation is for ${OTHER_EMAIL}. You're signed in as ${testUser.email}.`
    )
    expect(screen.getAllByText(OTHER_EMAIL)[0]).toHaveClass('ph-sensitive', 'ph-mask')
    expect(screen.getByText(/invited you to join/)).toHaveTextContent(
      'Ada Lovelace invited you to join Acme Corp as Editor.'
    )
    expect(accepts).toHaveLength(0)
    expect(verifies).toHaveLength(0)

    const assign = stubAssign()
    await user.click(screen.getByRole('button', { name: `Continue as ${OTHER_EMAIL}` }))

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith(ACCEPT_PATH)
    })
    expect(logouts).toBe(1)
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(accepts).toHaveLength(0)
    expect(verifies).toHaveLength(0)
  })

  it('cancels a switch to the dashboard, still signed in, and spends nothing', async () => {
    signIn()
    previewForSomeoneElse()
    const accepts = serveAccept(accepted())
    const verifies = serveVerify(verified())
    const logouts = serve('/api/v1/auth/logout', () => ok(null, 'Signed out.'))
    const user = userEvent.setup()
    const router = renderAt(ACCEPT_PATH)

    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/dashboard')
    })
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(accepts).toHaveLength(0)
    expect(verifies).toHaveLength(0)
    expect(logouts).toHaveLength(0)
  })

  it('carries the link’s campaign keys, and nothing else, through the reload after Continue', async () => {
    signIn()
    previewForSomeoneElse()
    server.use(http.post('/api/v1/auth/logout', () => ok(null, 'Signed out.')))
    const user = userEvent.setup()
    const campaign = 'utm_source=email&utm_medium=email&utm_campaign=tenant_invitation'
    renderAt(
      `${ACCEPT_PATH}&${campaign}&utm_content=${encodeURIComponent('a@b.test')}&email=${encodeURIComponent(OTHER_EMAIL)}`
    )

    const continueButton = await screen.findByRole('button', { name: `Continue as ${OTHER_EMAIL}` })
    const assign = stubAssign()
    await user.click(continueButton)

    // An address-shaped utm value fails the sanitizer's own check, so it goes, as does ?email=.
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith(`${ACCEPT_PATH}&${campaign}`)
    })
  })

  it.each([
    ['a 403', () => fail('This invitation was sent to a different email address.', 403)],
    ['a 404', () => fail(INVALID, 404, 'invitation_invalid')],
  ])('shows the dead invitation, with no address, on %s from accept', async (_name, refusal) => {
    signIn()
    serveAccept(refusal)
    renderAt(ACCEPT_PATH)

    expect(await screen.findByRole('heading', { level: 1, name: DEAD_TITLE })).toBeVisible()
    expect(screen.getByText(/for a new invite/)).toHaveTextContent(
      'Ask Ada Lovelace for a new invite.'
    )
    expect(screen.queryByText(/@/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the dashboard' })).toHaveAttribute(
      'href',
      '/dashboard'
    )
    expect(
      screen.queryByRole('button', { name: 'Email me a sign-in link' })
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Or sign in:')).not.toBeInTheDocument()
    // A refusal judges the invitation, not the session.
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('offers Try again when the accept fails for another reason, and the retry joins', async () => {
    signIn()
    mockTenantRoute()
    const accepts = serveAccept(() => fail('Server error.', 500), accepted())
    const user = userEvent.setup()
    const router = renderAt(ACCEPT_PATH)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'We couldn’t add you to Acme Corp' })
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    await expectLandedInTenant(router)
    expect(accepts).toHaveLength(2)
  })
})

describe('posts the invitation token exactly once under StrictMode', () => {
  it('posts the invitation token exactly once under StrictMode (signed out, verify)', async () => {
    arriveSignedOut()
    mockTenantRoute()
    const verifies = serveVerify(verified())
    const router = renderAt(ACCEPT_PATH)

    await expectLandedInTenant(router)
    expect(await screen.findAllByText(JOINED)).toHaveLength(1)
    expect(verifies).toHaveLength(1)
  })

  it('posts the invitation token exactly once under StrictMode (signed in, accept)', async () => {
    signIn()
    mockTenantRoute()
    const accepts = serveAccept(accepted())
    const router = renderAt(ACCEPT_PATH)

    await expectLandedInTenant(router)
    expect(await screen.findAllByText(JOINED)).toHaveLength(1)
    expect(accepts).toHaveLength(1)
  })

  it.each([
    ['signed out, verify', 'verify'],
    ['signed in, accept', 'accept'],
  ] as const)(
    'posts the invitation token exactly once under StrictMode with the preview already cached (%s)',
    async (_name, call) => {
      // A cached preview settles the page at mount, where StrictMode runs the effect twice.
      queryClient.setQueryData(invitationKeys.preview(TEST_INVITATION_TOKEN), testInvitationPreview)
      if (call === 'verify') arriveSignedOut()
      else signIn()
      mockTenantRoute()
      const verifies = serveVerify(verified())
      const accepts = serveAccept(accepted())
      const router = renderAt(ACCEPT_PATH)

      await expectLandedInTenant(router)
      expect(await screen.findAllByText(JOINED)).toHaveLength(1)
      expect(call === 'verify' ? verifies : accepts).toHaveLength(1)
      expect(call === 'verify' ? accepts : verifies).toHaveLength(0)
    }
  )
})

describe('a used link', () => {
  /** The preview of a used, expired or revoked link. */
  const previewGone = () => servePreview(() => fail(INVALID, 404, 'invitation_invalid'))

  it('tells the signed-in invitee they already joined and lands', async () => {
    signIn()
    previewGone()
    mockTenantRoute()
    const accepts = serveAccept(accepted(true))
    const verifies = serveVerify(verified())
    const router = renderAt(ACCEPT_PATH)

    await expectLandedInTenant(router)
    expect(await screen.findAllByText(ALREADY_JOINED)).toHaveLength(1)
    expect(accepts).toHaveLength(1)
    expect(verifies).toHaveLength(0)
  })

  it('checks the invitation, naming no address, while the accept runs', async () => {
    signIn()
    previewGone()
    serveAccept(held())
    renderAt(ACCEPT_PATH)

    // The skeleton shares the heading, so the status row is what marks the accept as running.
    expect(await screen.findByRole('status')).toHaveTextContent('Checking your invitation…')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Checking your invitation')
    expect(screen.queryByText(/@/)).not.toBeInTheDocument()
  })

  it('shows anyone else signed in the generic dead invitation with no address', async () => {
    signIn(OTHER_EMAIL)
    previewGone()
    const accepts = serveAccept(() => fail(INVALID, 404, 'invitation_invalid'))
    renderAt(ACCEPT_PATH)

    expect(await screen.findByRole('heading', { level: 1, name: DEAD_TITLE })).toBeVisible()
    expect(screen.getByText(ASK_THE_TEAM)).toBeVisible()
    expect(screen.queryByText(/@/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the dashboard' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Email me a sign-in link' })
    ).not.toBeInTheDocument()
    expect(accepts).toHaveLength(1)
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('shows a signed-out visitor the dead invitation without calling verify or accept', async () => {
    arriveSignedOut()
    previewGone()
    const accepts = serveAccept(accepted(true))
    const verifies = serveVerify(verified())
    renderAt(ACCEPT_PATH)

    expect(await screen.findByRole('heading', { level: 1, name: DEAD_TITLE })).toBeVisible()
    expect(screen.getByText(ASK_THE_TEAM)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Email me a sign-in link' })).toBeVisible()
    expect(screen.queryByText(/@/)).not.toBeInTheDocument()
    expect(accepts).toHaveLength(0)
    expect(verifies).toHaveLength(0)
  })
})
