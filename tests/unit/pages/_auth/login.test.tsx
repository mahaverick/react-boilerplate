import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHECK_INBOX_TITLE } from '@/components/features/auth/sign-in-link-form'
import { GOOGLE_OAUTH_PATH } from '@/constants/routes'
import { resetSessionForTests } from '@/http/session'
import { toast } from '@/lib/toast'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * Mounts the real route tree at `path` and returns the router, rather than rendering the
 * component alone: the page reads `Route.useSearch()` and calls `useNavigate()`, neither of
 * which works outside a router, and `?redirect=` handling is the heart of this page.
 */
function renderLoginAt(path: string): AnyRouter {
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

/**
 * A visitor with no refresh cookie, so `_auth`'s guard lets the login page
 * render instead of bouncing them to /dashboard.
 */
function arriveSignedOut() {
  resetSessionForTests()
  queryClient.clear()
  useAuthStore.setState({
    accessToken: null,
    user: null,
    isAuthenticated: false,
    isBootstrapped: false,
  })
  server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
}

/** The bodies the link-request endpoint received, in order; it answers 202. */
function serveLinkRequests() {
  const bodies: unknown[] = []
  server.use(
    http.post('/api/v1/auth/link/request', async ({ request }) => {
      bodies.push(await request.json())
      return ok(null, 'Check your inbox for a sign-in link.', 202)
    })
  )
  return bodies
}

/** Types an address and asks for a link, the way a visitor does. */
async function requestLink(email = 'ada@example.test') {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Email'), email)
  await user.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))
  await screen.findByText(/We sent a sign-in link to/)
}

describe('login page', () => {
  beforeEach(arriveSignedOut)

  it('shows one email field, the link button, the divider and Continue with Google', async () => {
    renderLoginAt('/login')

    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
    expect(
      screen.getByText('Enter your email and we’ll send you a link to sign in.')
    ).toBeInTheDocument()
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Password' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Email me a sign-in link' })).toBeInTheDocument()
    expect(screen.getByText('or')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Continue with Google' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Create an account' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Forgot password?' })).not.toBeInTheDocument()
    expect(
      screen.getByText('By signing in, you agree to our Terms of Service and Privacy Policy.')
    ).toBeInTheDocument()
  })

  it('switches to Check your inbox after sending', async () => {
    serveLinkRequests()
    renderLoginAt('/login')
    await requestLink()

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(CHECK_INBOX_TITLE)
    expect(CHECK_INBOX_TITLE).toBe('Check your inbox')
    // The description and Google belong to the email step only.
    expect(
      screen.queryByText('Enter your email and we’ll send you a link to sign in.')
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Continue with Google' })).not.toBeInTheDocument()
  })

  it('keeps the resend countdown running through the switch to Check your inbox', async () => {
    // Only the clock the countdown reads is faked, so the router's and React's own timers still run.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'], shouldAdvanceTime: true })
    try {
      serveLinkRequests()
      // The note and the Google button both leave the tree at the switch; the form must not remount with them.
      renderLoginAt('/login?notice=sign-in-link')
      await requestLink()
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(CHECK_INBOX_TITLE)
      expect(
        screen.getByRole('button', { name: /^Resend in 1:00$|^Resend in 0:59$/ })
      ).toBeVisible()

      await act(() => vi.advanceTimersByTimeAsync(5_000))

      const resend = screen.getByRole('button', { name: /^Resend in 0:5\d$/ })
      expect(resend).toHaveAttribute('aria-disabled', 'true')
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends the safe redirect with the request', async () => {
    const bodies = serveLinkRequests()
    renderLoginAt(`/login?redirect=${encodeURIComponent('/tenants/acme?tab=members')}`)
    await requestLink()

    expect(bodies).toEqual([
      { email: 'ada@example.test', app: 'web', redirect: '/tenants/acme?tab=members' },
    ])
  })

  it.each(['//evil.test', '/\\evil.test', 'https://evil.test', 'javascript:alert(1)'])(
    'drops an unsafe ?redirect before requesting the link (%s)',
    async (unsafe) => {
      const bodies = serveLinkRequests()
      renderLoginAt(`/login?redirect=${encodeURIComponent(unsafe)}`)
      await requestLink()

      expect(bodies).toHaveLength(1)
      expect(bodies[0]).not.toHaveProperty('redirect')
    }
  )

  it.each([
    `/auth/link?token=${'t'.repeat(43)}&email=a%40b.test`,
    `/auth/link/?token=${'t'.repeat(43)}`,
    `/Auth/Link?token=${'t'.repeat(43)}`,
    `/invitations/accept?token=${'t'.repeat(43)}`,
    `/invitations/accept//?token=${'t'.repeat(43)}`,
    `/invitations/confirm?token=${'t'.repeat(43)}&email=a%40b.test`,
  ])('does not carry a token page as the redirect (%s)', async (tokenPage) => {
    const bodies = serveLinkRequests()
    renderLoginAt(`/login?redirect=${encodeURIComponent(tokenPage)}`)
    expect(await screen.findByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
      'href',
      `${GOOGLE_OAUTH_PATH}?app=web`
    )
    await requestLink()

    expect(bodies[0]).not.toHaveProperty('redirect')
  })

  it('points Continue with Google at the API with app=web and the redirect', async () => {
    renderLoginAt(`/login?redirect=${encodeURIComponent('/tenants/acme')}`)

    expect(await screen.findByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
      'href',
      '/api/v1/auth/google?app=web&redirect=%2Ftenants%2Facme'
    )
  })

  it('points Continue with Google at app=web alone without a safe redirect', async () => {
    renderLoginAt(`/login?redirect=${encodeURIComponent('//evil.test')}`)

    expect(await screen.findByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
      'href',
      `${GOOGLE_OAUTH_PATH}?app=web`
    )
  })

  it('shows the sign-in-link note for notice=sign-in-link', async () => {
    renderLoginAt('/login?notice=sign-in-link')

    expect(
      await screen.findByText('Sign in with an email link or Google. Passwords no longer work.')
    ).toBeInTheDocument()
  })

  it('shows no note without the notice, and ignores an unknown one', async () => {
    const router = renderLoginAt('/login?notice=other')

    await screen.findByRole('button', { name: 'Email me a sign-in link' })
    expect(
      screen.queryByText('Sign in with an email link or Google. Passwords no longer work.')
    ).not.toBeInTheDocument()
    expect(router.state.location.search).not.toHaveProperty('notice', 'other')
  })

  it('lands on the redirect when another tab signs in', async () => {
    serveLinkRequests()
    const router = renderLoginAt(`/login?redirect=${encodeURIComponent('/notifications')}`)
    await requestLink()

    // The other tab used the link, so the shared refresh cookie now restores a session here.
    server.use(
      http.post('/api/v1/auth/refresh', () =>
        ok({ accessToken: 'fresh-token' }, 'Session refreshed.')
      ),
      http.get('/api/v1/profile', () => ok(testUser, 'Profile retrieved.'))
    )
    const otherTab = new BroadcastChannel('auth')
    try {
      otherTab.postMessage({ type: 'signed_in' })
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/notifications')
      })
    } finally {
      otherTab.close()
    }
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('lands on the dashboard when another tab signs in and there is no redirect', async () => {
    serveLinkRequests()
    const router = renderLoginAt('/login')
    await requestLink()

    server.use(
      http.post('/api/v1/auth/refresh', () =>
        ok({ accessToken: 'fresh-token' }, 'Session refreshed.')
      ),
      http.get('/api/v1/profile', () => ok(testUser, 'Profile retrieved.'))
    )
    const otherTab = new BroadcastChannel('auth')
    try {
      otherTab.postMessage({ type: 'signed_in' })
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/dashboard')
      })
    } finally {
      otherTab.close()
    }
  })
})

/** Each `?error=` code the API's Google callback redirects here with. */
describe('OAuth failure messages', () => {
  beforeEach(arriveSignedOut)

  it.each([
    [
      'email_not_verified',
      'Google hasn’t verified this email address. Verify it with Google, or sign in with an email link.',
    ],
    [
      'google_email_missing',
      'Your Google account didn’t share an email address. Sign in with an email link instead.',
    ],
    [
      'processing_failed',
      'Google sign-in didn’t finish. Try again, or sign in with an email link.',
    ],
    ['google_auth_failed', 'Google sign-in failed. Try again, or sign in with an email link.'],
    ['MAINTENANCE_MODE', 'Sign-in is paused for maintenance. Try again when maintenance ends.'],
    [
      'READ_ONLY_MODE',
      'We can’t create new accounts during maintenance. Sign in to an account you already have, or try again when maintenance ends.',
    ],
  ])('explains ?error=%s', async (code, message) => {
    renderLoginAt(`/login?error=${code}`)

    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it('falls back to a generic message for a code it does not know', async () => {
    renderLoginAt('/login?error=something_new')

    expect(
      await screen.findByText('Sign-in failed. Try again, or sign in with an email link.')
    ).toBeInTheDocument()
  })

  it('toasts the Google error once', async () => {
    const toastError = vi.spyOn(toast, 'error')
    serveLinkRequests()
    renderLoginAt('/login?error=google_auth_failed')
    await screen.findByText('Google sign-in failed. Try again, or sign in with an email link.')
    // A re-render (the switch to Check your inbox) must not raise it again.
    await requestLink()

    expect(toastError).toHaveBeenCalledTimes(1)
  })
})
