import { QueryClientProvider } from '@tanstack/react-query'
import {
  createBrowserHistory,
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
  type RouterHistory,
} from '@tanstack/react-router'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { APP_NAME, pageTitle } from '@/constants/app'
import { resetSessionForTests } from '@/http/session'
import { STEP_UP_WAIT_LOCK, STEP_UP_WAIT_QUERY_TIMEOUT_MS } from '@/lib/step-up-presence'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { removeWebLocks, stubWebLocks } from '@/tests/mocks/web-locks'

const TOKEN = 't'.repeat(43)
const LINK_PATH = `/auth/confirm?token=${TOKEN}`
const VERIFY_URL = '/api/v1/auth/step-up/link/verify'

/** Mounts the real route tree at `path`, under StrictMode as dev runs it, and returns the router. */
function renderAt(path: string): AnyRouter {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    ...ROUTER_DEFAULTS,
    history: createMemoryHistory({ initialEntries: [path] }),
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

/** The session that asked for the link, already restored. */
function signIn() {
  useAuthStore.setState({
    accessToken: 'access-token',
    user: testUser,
    isAuthenticated: true,
    isBootstrapped: true,
  })
}

/** A browser with no session: the bootstrap already settled signed out. */
function signOut() {
  useAuthStore.setState({
    accessToken: null,
    user: null,
    isAuthenticated: false,
    isBootstrapped: true,
  })
}

/** Records every verify call's body and bearer, answering with `respond`. */
function serveVerify(respond: () => Response = () => ok({ accessToken: 'stepped-up' })) {
  const calls: { body: unknown; authorization: string | null }[] = []
  server.use(
    http.post(VERIFY_URL, async ({ request }) => {
      calls.push({
        body: await request.json(),
        authorization: request.headers.get('authorization'),
      })
      return respond()
    })
  )
  return calls
}

/** Channels standing in for the waiting tab; closed after each test. */
let otherTabs: BroadcastChannel[] = []

/**
 * Opens a channel standing in for the tab that waits on the confirmation.
 * @returns What that tab has heard.
 */
function openWaitingTab() {
  const tab = new BroadcastChannel('auth')
  const received: unknown[] = []
  tab.addEventListener('message', (event: MessageEvent<unknown>) => {
    received.push(event.data)
  })
  otherTabs.push(tab)
  return received
}

/** Lets an already-queued channel delivery or a stray request land before a negative check. */
async function letStragglersLand() {
  await settle(50, 'absence has no event: let a queued post or channel delivery arrive')
}

beforeEach(() => {
  resetSessionForTests()
  queryClient.clear()
  signIn()
})

afterEach(() => {
  for (const tab of otherTabs) tab.close()
  otherTabs = []
  removeWebLocks()
  vi.restoreAllMocks()
})

describe('/auth/confirm with an emailed link', () => {
  it('confirms, swaps the token in and broadcasts step_up_confirmed', async () => {
    const calls = serveVerify()
    const received = openWaitingTab()
    renderAt(LINK_PATH)

    expect(await screen.findByRole('heading', { level: 1, name: 'Confirmed' })).toBeInTheDocument()
    expect(useAuthStore.getState().accessToken).toBe('stepped-up')
    expect(calls).toEqual([{ body: { token: TOKEN }, authorization: 'Bearer access-token' }])
    await vi.waitFor(() => expect(received).toEqual([{ type: 'step_up_confirmed' }]))
    await letStragglersLand()
    expect(received).toEqual([{ type: 'step_up_confirmed' }])
    expect(document.title).toBe(pageTitle('Confirm it’s you'))
  })

  it('posts the token exactly once under StrictMode', async () => {
    const calls = serveVerify()
    renderAt(LINK_PATH)

    await screen.findByRole('heading', { level: 1, name: 'Confirmed' })
    await letStragglersLand()
    expect(calls).toHaveLength(1)
  })

  it('shows the verifying frame while the confirmation runs', async () => {
    server.use(http.post(VERIFY_URL, () => new Promise<never>(() => {})))
    renderAt(LINK_PATH)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Confirming it’s you' })
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Confirming it’s you…')
  })

  it('says close this tab while a waiting tab holds the lock', async () => {
    const events: string[] = []
    const locks = stubWebLocks(() => events.push('query'))
    locks.held.push({ name: STEP_UP_WAIT_LOCK, mode: 'shared' })
    serveVerify(() => {
      events.push('verify')
      // The waiting tab lets go once it hears the broadcast; the page's answer must not change.
      locks.held.length = 0
      return ok({ accessToken: 'stepped-up' })
    })
    renderAt(LINK_PATH)

    expect(await screen.findByText('You can close this tab.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Confirmed' })).toBeInTheDocument()
    // Read before the post: once the broadcast lands, the waiting tab retries and releases the lock.
    expect(events).toEqual(['query', 'verify'])
  })

  it('says go back and try again when no tab waits', async () => {
    stubWebLocks()
    serveVerify()
    renderAt(LINK_PATH)

    expect(
      await screen.findByText(`Go back to ${APP_NAME} and try the action again.`)
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Dashboard' })).toHaveAttribute(
      'href',
      '/dashboard'
    )
  })

  it('says return to the starting tab where Web Locks are missing', async () => {
    expect('locks' in navigator).toBe(false)
    serveVerify()
    renderAt(LINK_PATH)

    expect(
      await screen.findByText(
        `Return to the ${APP_NAME} tab where you started. If you closed it, try the action again.`
      )
    ).toBeInTheDocument()
  })

  it('says go back and try again where BroadcastChannel is missing, since no tab can hear', async () => {
    const locks = stubWebLocks()
    locks.held.push({ name: STEP_UP_WAIT_LOCK, mode: 'shared' })
    vi.stubGlobal('BroadcastChannel', undefined)
    serveVerify()
    try {
      renderAt(LINK_PATH)
      expect(
        await screen.findByText(`Go back to ${APP_NAME} and try the action again.`)
      ).toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('posts nothing and names the starting browser when signed out', async () => {
    signOut()
    const calls = serveVerify()
    const received = openWaitingTab()
    renderAt(LINK_PATH)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sign in to confirm' })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'This link works only in the browser and session that asked for it. If you signed out here, sign in and repeat the action.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
    await letStragglersLand()
    expect(calls).toEqual([])
    expect(received).toEqual([])
  })

  it('names the fix when the link carries no token', async () => {
    const calls = serveVerify()
    renderAt('/auth/confirm')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'This link is incomplete' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Open the most recent confirmation email and use its link.')
    ).toBeInTheDocument()
    await letStragglersLand()
    expect(calls).toEqual([])
  })

  it('shows the one dead-link message on a 400 and broadcasts nothing', async () => {
    serveVerify(() =>
      fail('This link expired or was already used. Ask for a new link.', 400, 'LINK_INVALID')
    )
    const received = openWaitingTab()
    renderAt(LINK_PATH)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'This link didn’t confirm it’s you' })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Open the link in the browser where you asked for it, within 15 minutes. For a new link, try the action again.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    await letStragglersLand()
    expect(received).toEqual([])
    expect(useAuthStore.getState().accessToken).toBe('access-token')
  })

  it('treats the validation 400 as the same dead link', async () => {
    serveVerify(() => fail('Check the highlighted fields, then try again.', 400))
    renderAt(LINK_PATH)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'This link didn’t confirm it’s you' })
    ).toBeInTheDocument()
  })

  /**
   * Swaps `location` for a stub whose `assign` is a spy, so a full-page redirect is seen, not run.
   * @returns The spy.
   */
  function spyOnRedirects() {
    const assign = vi.fn()
    // jsdom's Location accessors live on the prototype, so a spread copies none of them.
    const { origin, protocol, host, hostname, port } = window.location
    vi.stubGlobal('location', {
      origin,
      protocol,
      host,
      hostname,
      port,
      href: `${origin}${LINK_PATH}`,
      pathname: '/auth/confirm',
      search: `?token=${TOKEN}`,
      hash: '',
      assign,
      replace: assign,
    })
    return assign
  }

  /** Counts refreshes, answering each with `respond`. */
  function serveRefresh(respond: () => Response) {
    const seen = { refreshes: 0 }
    server.use(
      http.post('/api/v1/auth/refresh', () => {
        seen.refreshes += 1
        return respond()
      })
    )
    return seen
  }

  it('says the session ended when the refresh after a 401 is refused, and does not redirect', async () => {
    const assign = spyOnRedirects()
    const seen = serveRefresh(() => fail('Unauthorized', 401))
    const calls = serveVerify(() =>
      fail('This session ended. Sign in again to continue.', 401, 'ACCESS_TOKEN_EXPIRED')
    )
    try {
      const router = renderAt(LINK_PATH)

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Your session ended' })
      ).toBeInTheDocument()
      expect(screen.getByText('Sign in again, then repeat the action.')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
      await letStragglersLand()
      expect(calls).toHaveLength(1)
      expect(seen.refreshes).toBe(1)
      expect(assign).not.toHaveBeenCalled()
      expect(router.state.location.pathname).toBe('/auth/confirm')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('confirms after refreshing an expired access token once', async () => {
    const assign = spyOnRedirects()
    const seen = serveRefresh(() => ok({ accessToken: 'fresh-token' }, 'Session refreshed.'))
    const calls = serveVerify(() =>
      calls.length === 1
        ? fail('Your sign-in expired. Sign in again to continue.', 401, 'ACCESS_TOKEN_EXPIRED')
        : ok({ accessToken: 'stepped-up' })
    )
    const received = openWaitingTab()
    try {
      renderAt(LINK_PATH)

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Confirmed' })
      ).toBeInTheDocument()
      expect(calls.map((call) => call.authorization)).toEqual([
        'Bearer access-token',
        'Bearer fresh-token',
      ])
      expect(seen.refreshes).toBe(1)
      expect(useAuthStore.getState().accessToken).toBe('stepped-up')
      expect(assign).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(received).toEqual([{ type: 'step_up_confirmed' }]))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('sends one request for two fast clicks on Try again, and keeps the success', async () => {
    /** The verify's next answer: a 503 until the clicks. */
    let answer: () => Response = () => fail('Service Unavailable', 503)
    const calls = serveVerify(() => answer())
    renderAt(LINK_PATH)
    const retry = await screen.findByRole('button', { name: 'Try again' })

    answer = () =>
      calls.length === 2
        ? ok({ accessToken: 'stepped-up' })
        : fail('This link expired or was already used. Ask for a new link.', 400, 'LINK_INVALID')
    // One act batches both: React renders the busy button only after the second click.
    act(() => {
      retry.click()
      retry.click()
    })

    expect(await screen.findByRole('heading', { level: 1, name: 'Confirmed' })).toBeInTheDocument()
    await letStragglersLand()
    expect(calls).toHaveLength(2)
    expect(screen.getByRole('heading', { level: 1, name: 'Confirmed' })).toBeInTheDocument()
  })

  it('confirms with the cannot-tell copy when the lock query never answers', async () => {
    stubWebLocks()
    Object.assign(navigator.locks, { query: () => new Promise<never>(() => {}) })
    serveVerify()
    renderAt(LINK_PATH)

    expect(
      await screen.findByText(
        `Return to the ${APP_NAME} tab where you started. If you closed it, try the action again.`,
        undefined,
        // The page's own bound on the lock query is the claim under test.
        { timeout: STEP_UP_WAIT_QUERY_TIMEOUT_MS * 3 }
      )
    ).toBeInTheDocument()
  })

  it.each([
    [
      429,
      () =>
        fail("You've reached the limit of 20 requests in 1 minute. Try again in 60 seconds.", 429),
    ],
    [503, () => fail('Service Unavailable', 503)],
    ['network', () => HttpResponse.error()],
  ] as const)('offers Try again on %s', async (_label, failure) => {
    let answer: () => Response = failure
    const calls = serveVerify(() => answer())
    const received = openWaitingTab()
    const user = userEvent.setup()
    renderAt(LINK_PATH)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'We couldn’t confirm it’s you' })
    ).toBeInTheDocument()
    expect(screen.getByRole('alert')).not.toBeEmptyDOMElement()
    expect(received).toEqual([])

    answer = () => ok({ accessToken: 'stepped-up' })
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Confirmed' })).toBeInTheDocument()
    expect(calls).toHaveLength(2)
    expect(useAuthStore.getState().accessToken).toBe('stepped-up')
    await vi.waitFor(() => expect(received).toEqual([{ type: 'step_up_confirmed' }]))
  })
})

describe('/auth/confirm without a token', () => {
  it.each(['result=confirmed', 'error=step_up_failed', 'result=maybe&error=other'])(
    'treats ?%s as an incomplete link: no broadcast, no post, no close',
    async (query) => {
      const close = vi.spyOn(window, 'close').mockImplementation(() => {})
      const calls = serveVerify()
      const received = openWaitingTab()
      renderAt(`/auth/confirm?${query}`)

      expect(
        await screen.findByRole('heading', { level: 1, name: 'This link is incomplete' })
      ).toBeInTheDocument()
      await letStragglersLand()
      expect(received).toEqual([])
      expect(calls).toEqual([])
      expect(close).not.toHaveBeenCalled()
    }
  )
})

describe('/auth/confirm reached signed in', () => {
  it('stays on the page instead of bouncing to the dashboard', async () => {
    serveVerify()
    const router = renderAt(LINK_PATH)

    await screen.findByRole('heading', { level: 1, name: 'Confirmed' })
    await waitFor(() => expect(router.state.location.pathname).toBe('/auth/confirm'))
  })
})

describe('/auth/confirm and the address bar', () => {
  let history: RouterHistory | undefined

  /** Mounts the route tree on the real browser history at `path`, as the app runs. */
  function renderInBrowserAt(path: string) {
    window.history.replaceState(null, '', path)
    history = createBrowserHistory()
    const router = createRouter({
      routeTree,
      context: { queryClient },
      ...ROUTER_DEFAULTS,
      history,
    })
    render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router as never} />
        </QueryClientProvider>
      </StrictMode>
    )
  }

  afterEach(() => {
    history?.destroy()
    history = undefined
    window.history.replaceState(null, '', '/')
  })

  it.each([
    ['a confirmation', () => ok({ accessToken: 'stepped-up' }), 'Confirmed'],
    [
      'a dead link',
      () => fail('This link expired or was already used. Ask for a new link.', 400, 'LINK_INVALID'),
      'This link didn’t confirm it’s you',
    ],
  ])(
    'drops the token from the URL after %s, keeping the outcome and the rest of the query',
    async (_name, respond, heading) => {
      serveVerify(respond)
      renderInBrowserAt(`${LINK_PATH}&utm_source=email`)

      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
      await waitFor(() => expect(window.location.search).toBe('?utm_source=email'))
      expect(window.location.pathname).toBe('/auth/confirm')
      expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
    }
  )

  it('keeps the token while Try again can still use it', async () => {
    serveVerify(() => fail('Service Unavailable', 503))
    renderInBrowserAt(LINK_PATH)

    await screen.findByRole('button', { name: 'Try again' })
    await letStragglersLand()
    expect(new URLSearchParams(window.location.search).get('token')).toBe(TOKEN)
  })

  it('posts nothing on a reload after a confirmation', async () => {
    const calls = serveVerify()
    renderInBrowserAt(LINK_PATH)
    await screen.findByRole('heading', { level: 1, name: 'Confirmed' })
    await waitFor(() => expect(window.location.search).toBe(''))
    history?.destroy()
    cleanup()

    // A reload opens what the address bar now holds.
    renderInBrowserAt(`${window.location.pathname}${window.location.search}`)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'This link is incomplete' })
    ).toBeInTheDocument()
    await letStragglersLand()
    expect(calls).toHaveLength(1)
  })
})
