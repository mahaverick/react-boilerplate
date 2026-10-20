import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHECK_INBOX_TITLE } from '@/components/features/auth/sign-in-link-form'
import { GOOGLE_OAUTH_PATH } from '@/constants/routes'
import { resetSessionForTests } from '@/http/session'
import { toast } from '@/lib/toast'
import { track } from '@/observability/telemetry'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const webauthn = vi.hoisted(() => ({
  support: vi.fn(),
  request: vi.fn(),
  cancel: vi.fn(),
  signal: vi.fn(),
}))

// Only the browser-facing calls are replaced; passkeyFailure and the cancel generation stay real.
vi.mock('@/lib/webauthn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/webauthn')>()),
  passkeySupport: webauthn.support,
  requestPasskey: webauthn.request,
  cancelPasskeyPrompt: webauthn.cancel,
  signalUnknownPasskey: webauthn.signal,
}))

vi.mock('@/observability/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/observability/telemetry')>()),
  track: vi.fn(),
  yieldSharedIdentity: vi.fn(),
}))

afterEach(() => {
  vi.restoreAllMocks()
})

beforeEach(() => {
  // Every other test here runs in a browser with no WebAuthn: no button, no autofill.
  webauthn.support.mockReset().mockResolvedValue({ create: false, autofill: false })
  webauthn.request.mockReset()
  webauthn.cancel.mockReset()
  webauthn.signal.mockReset()
  vi.mocked(track).mockClear()
})

/**
 * Mounts the real route tree at `path` and returns the router, rather than rendering the
 * component alone: the page reads `Route.useSearch()` and calls `useNavigate()`, neither of
 * which works outside a router, and `?redirect=` handling is the heart of this page.
 */
function renderLoginAt(path: string, strict = false): AnyRouter {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
    ...ROUTER_DEFAULTS,
  })
  const tree = (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  render(strict ? <StrictMode>{tree}</StrictMode> : tree)
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
      GOOGLE_OAUTH_PATH
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
      GOOGLE_OAUTH_PATH
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

describe('login page passkeys', () => {
  const RESPONSE = { id: 'cred-1', rawId: 'cred-1', type: 'public-key', response: {} }
  /** A sign-in challenge the options endpoint hands out. */
  const CHALLENGE = { challengeId: 'chal-1', options: { challenge: 'abc' } }

  let optionsCalls: number
  let verifyBodies: unknown[]

  beforeEach(() => {
    arriveSignedOut()
    optionsCalls = 0
    verifyBodies = []
    webauthn.support.mockResolvedValue({ create: true, autofill: true })
    server.use(
      http.post('/api/v1/auth/passkeys/sign-in/options', () => {
        optionsCalls += 1
        return ok(CHALLENGE, 'Options.')
      })
    )
  })

  /** Answers verify with a sign-in, or with the given refusal. */
  function serveVerify(refusal?: { message: string; status: number; code: string }) {
    server.use(
      http.post('/api/v1/auth/passkeys/sign-in/verify', async ({ request }) => {
        verifyBodies.push(await request.json())
        if (refusal) return fail(refusal.message, refusal.status, refusal.code)
        return ok(
          { user: testUser, accessToken: 'passkey-token', isNewUser: false, redirect: null },
          'Signed in.'
        )
      })
    )
  }

  /** A request mock: autofill waits until the page aborts it; the modal prompt answers `modal`. */
  function pendingAutofill(modal: () => Promise<unknown>) {
    const aborted: Array<() => void> = []
    webauthn.request.mockImplementation((_options: unknown, mode: string) => {
      if (mode === 'modal') {
        aborted.splice(0).forEach((abort) => abort())
        return modal()
      }
      return new Promise((_resolve, reject) => {
        aborted.push(() => reject(new DOMException('aborted', 'AbortError')))
      })
    })
  }

  /** Waits for the autofill request, then returns the autofill calls so far. */
  async function autofillCalls() {
    await waitFor(() => expect(webauthn.request).toHaveBeenCalled())
    return webauthn.request.mock.calls.filter(([, mode]) => mode === 'autofill')
  }

  it('mode off renders no passkey button, keeps autocomplete="email" and calls nothing', async () => {
    server.use(
      http.get('/api/v1/auth/passkeys/config', () => ok({ mode: 'off', rpId: '' }, 'Settings.'))
    )
    renderLoginAt('/login')

    const email = await screen.findByLabelText('Email')
    await screen.findByRole('link', { name: 'Continue with Google' })
    expect(email).toHaveAttribute('autocomplete', 'email')
    expect(screen.queryByRole('button', { name: 'Sign in with a passkey' })).not.toBeInTheDocument()
    expect(webauthn.support).not.toHaveBeenCalled()
    expect(webauthn.request).not.toHaveBeenCalled()
    expect(optionsCalls).toBe(0)
  })

  it('a failed config read behaves like mode off', async () => {
    server.use(http.get('/api/v1/auth/passkeys/config', () => fail('Not found.', 404)))
    renderLoginAt('/login')

    expect(await screen.findByLabelText('Email')).toHaveAttribute('autocomplete', 'email')
    expect(screen.queryByRole('button', { name: 'Sign in with a passkey' })).not.toBeInTheDocument()
    expect(optionsCalls).toBe(0)
  })

  it('optional mode sets autocomplete="username webauthn" and starts one autofill request, even in StrictMode', async () => {
    pendingAutofill(() => new Promise(() => undefined))
    renderLoginAt('/login', true)

    await waitFor(() =>
      expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'username webauthn')
    )
    const calls = await autofillCalls()
    await settle(50, 'let a stray second request show up')
    expect(calls).toHaveLength(1)
    expect(webauthn.request).toHaveBeenCalledTimes(1)
    expect(optionsCalls).toBe(1)
  })

  it('shows no autofill token or request where the browser has no autofill, but keeps the button', async () => {
    webauthn.support.mockResolvedValue({ create: true, autofill: false })
    renderLoginAt('/login')

    expect(await screen.findByRole('button', { name: 'Sign in with a passkey' })).toBeVisible()
    await settle(30, 'let an unwanted autofill request show up')
    expect(webauthn.request).not.toHaveBeenCalled()
  })

  it('the button signs in, posts { challengeId, response, app: "web" }, tracks sign_in_completed and lands on the dashboard', async () => {
    serveVerify()
    pendingAutofill(() => Promise.resolve(RESPONSE))
    const router = renderLoginAt('/login')

    await autofillCalls()
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Sign in with a passkey' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
    expect(verifyBodies).toEqual([{ challengeId: 'chal-1', response: RESPONSE, app: 'web' }])
    expect(track).toHaveBeenCalledWith('sign_in_completed', { method: 'passkey' })
    expect(useAuthStore.getState().accessToken).toBe('passkey-token')
  })

  it('lands on the safe redirect', async () => {
    serveVerify()
    pendingAutofill(() => Promise.resolve(RESPONSE))
    const router = renderLoginAt(`/login?redirect=${encodeURIComponent('/notifications')}`)

    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Sign in with a passkey' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/notifications'))
  })

  it('PASSKEY_UNKNOWN toasts the server message and signals the unknown credential with the config rpId', async () => {
    const toastError = vi.spyOn(toast, 'error')
    serveVerify({ message: 'We don’t know this passkey.', status: 400, code: 'PASSKEY_UNKNOWN' })
    pendingAutofill(() => Promise.resolve(RESPONSE))
    renderLoginAt('/login')

    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Sign in with a passkey' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('We don’t know this passkey.'))
    expect(webauthn.signal).toHaveBeenCalledWith('localhost', 'cred-1')
  })

  it('PASSKEY_NO_ACCESS toasts the server message and sends no signal', async () => {
    const toastError = vi.spyOn(toast, 'error')
    serveVerify({
      message: 'This passkey can’t sign in here.',
      status: 403,
      code: 'PASSKEY_NO_ACCESS',
    })
    pendingAutofill(() => Promise.resolve(RESPONSE))
    renderLoginAt('/login')

    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Sign in with a passkey' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('This passkey can’t sign in here.'))
    expect(webauthn.signal).not.toHaveBeenCalled()
  })

  it('a 503 MAINTENANCE_MODE toasts the sign-in page’s maintenance line', async () => {
    const toastError = vi.spyOn(toast, 'error')
    serveVerify({ message: 'Down.', status: 503, code: 'MAINTENANCE_MODE' })
    pendingAutofill(() => Promise.resolve(RESPONSE))
    renderLoginAt('/login')

    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Sign in with a passkey' }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Sign-in is paused for maintenance. Try again when maintenance ends.'
      )
    )
  })

  it('a cancelled button prompt shows no toast, tracks passkey_prompt_cancelled and restarts autofill', async () => {
    const toastError = vi.spyOn(toast, 'error')
    pendingAutofill(() => Promise.reject(new DOMException('no', 'NotAllowedError')))
    renderLoginAt('/login')

    await autofillCalls()
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Sign in with a passkey' }))

    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('passkey_prompt_cancelled', { ceremony: 'sign_in' })
    )
    // The pending autofill was aborted by the modal, and the page asks for a new one.
    await waitFor(async () => expect(await autofillCalls()).toHaveLength(2))
    expect(toastError).not.toHaveBeenCalled()
  })

  it('restarts autofill once, quietly, after a failed verify; the second failure toasts', async () => {
    const toastError = vi.spyOn(toast, 'error')
    serveVerify({ message: 'Stale options.', status: 400, code: 'PASSKEY_VERIFICATION_FAILED' })
    webauthn.request.mockResolvedValue(RESPONSE)
    renderLoginAt('/login')

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Stale options.'))
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(webauthn.request).toHaveBeenCalledTimes(2)
    expect(optionsCalls).toBe(2)
    expect(verifyBodies).toHaveLength(2)
  })

  it('an autofill pick signs in and lands on the dashboard', async () => {
    serveVerify()
    webauthn.request.mockResolvedValue(RESPONSE)
    const router = renderLoginAt('/login')

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
    expect(track).toHaveBeenCalledWith('sign_in_completed', { method: 'passkey' })
  })

  it('aborts the autofill request when the link form unmounts and on unmount', async () => {
    serveLinkRequests()
    pendingAutofill(() => new Promise(() => undefined))
    const view = renderLoginAt('/login')
    await autofillCalls()
    webauthn.cancel.mockClear()

    await requestLink()
    await waitFor(() => expect(webauthn.cancel).toHaveBeenCalled())
    // Nothing starts a new request behind the inbox card.
    await settle(30, 'let an unwanted autofill request show up')
    expect(webauthn.request).toHaveBeenCalledTimes(1)
    expect(view.state.location.pathname).toBe('/login')
  })

  it('cancels the pending prompt when the page unmounts', async () => {
    pendingAutofill(() => new Promise(() => undefined))
    renderLoginAt('/login')
    await autofillCalls()
    webauthn.cancel.mockClear()

    cleanup()

    expect(webauthn.cancel).toHaveBeenCalled()
  })

  it('hides the button where the browser has no WebAuthn', async () => {
    webauthn.support.mockResolvedValue({ create: false, autofill: false })
    renderLoginAt('/login')

    await screen.findByRole('link', { name: 'Continue with Google' })
    await settle(30, 'let the support check finish')
    expect(screen.queryByRole('button', { name: 'Sign in with a passkey' })).not.toBeInTheDocument()
    expect(webauthn.request).not.toHaveBeenCalled()
  })
})
