import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StepUpProvider } from '@/components/features/step-up/step-up-provider'
import { useStepUp } from '@/hooks/use-step-up'
import { apiClient } from '@/http/client'
import { ensureSession, resetSessionForTests } from '@/http/session'
import { STEP_UP_WAIT_LOCK } from '@/lib/step-up-presence'
import { toast } from '@/lib/toast'
import { useAuthStore } from '@/states/auth.store'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { freshlyConfirmedToken, testJwt } from '@/tests/mocks/jwt'
import { server } from '@/tests/mocks/server'
import { STEP_UP_EMAIL_WAIT } from '@/tests/mocks/step-up'
import { removeWebLocks, stubWebLocks } from '@/tests/mocks/web-locks'
import { REAUTH_REQUIRED } from '@/types/api.types'

const DIALOG = 'Confirm it’s you'
const START_BODY =
  'This action needs a confirmation from the last 10 minutes. We’ll email you a link to open in this browser.'
const EXPIRED = 'That link expired. Send a new link to continue.'
const RESUME_FAILED =
  'You confirmed, but we couldn’t reach the server. Check your connection, then select Try again.'

/** Every event the server saw, in order, so a test can assert what ran first. */
let events: string[] = []

/** Runs one guarded request through `useStepUp` and prints how it ended. */
function Harness() {
  const stepUp = useStepUp()
  const [outcome, setOutcome] = useState('idle')
  return (
    <>
      <button
        type="button"
        onClick={() => {
          stepUp
            .run(() => apiClient.post('/danger', { reason: 'r' }))
            .then(
              () => setOutcome('done'),
              () => setOutcome('failed')
            )
        }}
      >
        Do it
      </button>
      <p>outcome: {outcome}</p>
    </>
  )
}

/** Mounts `Harness` inside `StepUpProvider` with a query client that does not retry. */
function renderHarness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <StepUpProvider>
        <Harness />
      </StepUpProvider>
    </QueryClientProvider>
  )
}

/** `/danger` refuses the first `stale` calls with REAUTH_REQUIRED, then succeeds; returns the bearers it saw. */
function dangerRoute(stale: number) {
  const calls: string[] = []
  server.use(
    http.post('/api/v1/danger', ({ request }) => {
      calls.push(request.headers.get('authorization') ?? '')
      events.push('action')
      return calls.length <= stale
        ? fail('Recent sign-in required', 401, REAUTH_REQUIRED)
        : ok(null, 'Done.')
    })
  )
  return calls
}

/** The step-up link request: answers 202 one minute out by default, and records each body. */
function linkRoute(answer?: () => Response) {
  const bodies: unknown[] = []
  server.use(
    http.post('/api/v1/auth/step-up/link/request', async ({ request }) => {
      bodies.push(await request.json())
      events.push('link')
      return (
        answer?.() ??
        ok(
          { resendAvailableAt: new Date(Date.now() + 60_000).toISOString() },
          'Check your inbox for a confirmation link.',
          202
        )
      )
    })
  )
  return bodies
}

/** The refresh after a confirmation: a token minted by `mint`, recorded in `events`. */
function refreshRoute(
  mint: () => Response | Promise<Response> = () => ok({ accessToken: freshlyConfirmedToken() })
) {
  server.use(
    http.post('/api/v1/auth/refresh', () => {
      events.push('refresh')
      return mint()
    })
  )
}

/** A 429 as express sends it, with `Retry-After` in seconds. */
function tooMany(message: string, code: string, seconds: number) {
  return HttpResponse.json(
    { success: false, message, statusCode: 429, code, requestId: 'r' },
    { status: 429, headers: { 'Retry-After': String(seconds) } }
  )
}

/** Serves the caller's sign-in methods with Google linked; returns how many reads it answered. */
function withGoogle() {
  let reads = 0
  server.use(
    http.get('/api/v1/auth/providers', () => {
      reads += 1
      return ok(
        {
          providers: [
            { provider: 'email', linkedAt: '2026-01-01T00:00:00.000Z' },
            { provider: 'google', linkedAt: '2026-01-02T00:00:00.000Z' },
          ],
        },
        'Auth providers retrieved.'
      )
    })
  )
  return () => reads
}

/** Channels standing in for the confirm tab; closed after each test. */
let otherTabs: BroadcastChannel[] = []

/** Posts `step_up_confirmed` from another tab, as `/auth/confirm` does. */
function confirmFromAnotherTab() {
  const tab = new BroadcastChannel('auth')
  otherTabs.push(tab)
  tab.postMessage({ type: 'step_up_confirmed' })
}

/** Opens the dialog over the guarded action and returns it. */
async function openStepUp(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Do it' }))
  return screen.findByRole('dialog', { name: DIALOG })
}

/** Opens the dialog and sends a link, then returns the dialog in its wait view. */
async function sendLink(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await openStepUp(user)
  await user.click(within(dialog).getByRole('button', { name: 'Email me a link' }))
  await within(dialog).findByText(STEP_UP_EMAIL_WAIT)
  return dialog
}

/** The step-up dialog's own backdrop. */
function backdrop(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')
  if (!element) throw new Error('no dialog backdrop')
  return element
}

/** Whether the step-up wait lock is held on the stubbed lock manager. */
function holdsWaitLock(locks: ReturnType<typeof stubWebLocks>) {
  return locks.held.some((lock) => lock.name === STEP_UP_WAIT_LOCK)
}

beforeEach(() => {
  events = []
  resetSessionForTests()
  useAuthStore.setState({
    accessToken: 'old-token',
    user: testUser,
    isAuthenticated: true,
    isBootstrapped: true,
  })
})

afterEach(() => {
  for (const tab of otherTabs) tab.close()
  otherTabs = []
  removeWebLocks()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useStepUp', () => {
  it('throws outside <StepUpProvider>', () => {
    /** Calls the hook with no provider above it. */
    function Orphan() {
      useStepUp()
      return null
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Orphan />)).toThrow('useStepUp must be used inside <StepUpProvider>')
    consoleError.mockRestore()
  })

  it('runs the action straight through when no step-up is needed', async () => {
    const calls = dangerRoute(0)
    const user = userEvent.setup()
    renderHarness()
    await user.click(screen.getByRole('button', { name: 'Do it' }))
    expect(await screen.findByText('outcome: done')).toBeInTheDocument()
    expect(calls).toHaveLength(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('rejects any other failure unchanged, without asking', async () => {
    let calls = 0
    server.use(
      http.post('/api/v1/danger', () => {
        calls += 1
        return fail('Tenant is already suspended.', 409)
      })
    )
    const user = userEvent.setup()
    renderHarness()
    await user.click(screen.getByRole('button', { name: 'Do it' }))
    expect(await screen.findByText('outcome: failed')).toBeInTheDocument()
    expect(calls).toBe(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('retries without asking when another confirmation already swapped a fresher token in', async () => {
    const calls: string[] = []
    server.use(
      http.post('/api/v1/danger', ({ request }) => {
        calls.push(request.headers.get('authorization') ?? '')
        if (calls.length === 1) {
          // Another action's confirmation lands while this request is in flight.
          useAuthStore.getState().setToken('newer-token')
          return fail('Recent sign-in required', 401, REAUTH_REQUIRED)
        }
        return ok(null, 'Done.')
      })
    )
    const user = userEvent.setup()
    renderHarness()
    await user.click(screen.getByRole('button', { name: 'Do it' }))
    expect(await screen.findByText('outcome: done')).toBeInTheDocument()
    expect(calls).toEqual(['Bearer old-token', 'Bearer newer-token'])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('StepUpDialog: start', () => {
  it('opens Confirm it’s you on REAUTH_REQUIRED with the email link only, Google linked or not', async () => {
    dangerRoute(1)
    const providerReads = withGoogle()
    const user = userEvent.setup()
    renderHarness()
    const dialog = await openStepUp(user)
    expect(within(dialog).getByText(START_BODY)).toBeInTheDocument()
    const email = within(dialog).getByRole('button', { name: 'Email me a link' })
    await waitFor(() => expect(email).toHaveFocus())
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    await settle(
      50,
      'a Google button would need the providers read; absence has no event to wait on'
    )
    expect(within(dialog).getAllByRole('button')).toHaveLength(2)
    expect(within(dialog).queryByRole('button', { name: /Google/ })).not.toBeInTheDocument()
    expect(providerReads()).toBe(0)
  })

  it('with no dialog open beneath, Escape on the start dismisses and focus goes back to what asked', async () => {
    dangerRoute(1)
    const user = userEvent.setup()
    renderHarness()
    const trigger = screen.getByRole('button', { name: 'Do it' })
    await openStepUp(user)
    await user.keyboard('{Escape}')
    expect(await screen.findByText('outcome: failed')).toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('shows the server’s message on a failed link request, and stays on the start', async () => {
    dangerRoute(1)
    linkRoute(() => fail('Link requests are paused.', 503))
    const user = userEvent.setup()
    renderHarness()
    const dialog = await openStepUp(user)
    await user.click(within(dialog).getByRole('button', { name: 'Email me a link' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Link requests are paused.')
    expect(within(dialog).getByText(START_BODY)).toBeInTheDocument()
  })

  it('shows a rate limit on the start with the server’s words', async () => {
    dangerRoute(1)
    linkRoute(() =>
      tooMany(
        "You've reached the limit of 10 attempts in 15 minutes. Try again in 5 minutes.",
        'RATE_LIMITED',
        300
      )
    )
    const user = userEvent.setup()
    renderHarness()
    const dialog = await openStepUp(user)
    await user.click(within(dialog).getByRole('button', { name: 'Email me a link' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "You've reached the limit of 10 attempts in 15 minutes. Try again in 5 minutes."
    )
    expect(within(dialog).queryByText(STEP_UP_EMAIL_WAIT)).not.toBeInTheDocument()
  })
})

describe('StepUpDialog: email', () => {
  it('sends a link and shows the wait with a live resend countdown', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    dangerRoute(1)
    const bodies = linkRoute()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderHarness()
    const dialog = await sendLink(user)

    expect(bodies).toEqual([{ app: 'web' }])
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      `We sent the link to ${testUser.email}. It expires in 15 minutes.`
    )
    expect(within(dialog).getByRole('button', { name: 'Resend in 1:00' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(within(dialog).getByRole('button', { name: 'Resend in 0:59' })).toBeInTheDocument()

    await act(() => vi.advanceTimersByTimeAsync(59_000))
    await user.click(within(dialog).getByRole('button', { name: 'Resend link' }))
    await vi.waitFor(() => expect(bodies).toHaveLength(2))
    await vi.waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Resend in 1:00' })).toBeInTheDocument()
    )
  })

  it('moves focus to Resend once the link is sent, so the keyboard is not stranded', async () => {
    dangerRoute(1)
    linkRoute()
    const user = userEvent.setup()
    renderHarness()
    const dialog = await sendLink(user)
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: /^Resend in/ })).toHaveFocus()
    )
  })

  it('keeps the email view and counts from Retry-After on a 429 STEP_UP_LINK_COOLDOWN', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    dangerRoute(1)
    linkRoute(() =>
      tooMany(
        'Check your inbox for the link we sent. You can ask for another in 42 seconds.',
        'STEP_UP_LINK_COOLDOWN',
        42
      )
    )
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderHarness()
    const dialog = await sendLink(user)
    expect(within(dialog).getByRole('button', { name: 'Resend in 0:42' })).toBeInTheDocument()
  })

  it('raises the resend wait and toasts on a rate limit while waiting, and stays in the wait', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    dangerRoute(1)
    let refuse = false
    linkRoute(() =>
      refuse
        ? tooMany(
            "You've reached the limit of 10 attempts in 15 minutes. Try again in 2 minutes.",
            'RATE_LIMITED',
            120
          )
        : ok(
            { resendAvailableAt: new Date(Date.now() + 60_000).toISOString() },
            'Check your inbox for a confirmation link.',
            202
          )
    )
    const error = vi.spyOn(toast, 'error')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderHarness()
    const dialog = await sendLink(user)
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    refuse = true
    await user.click(within(dialog).getByRole('button', { name: 'Resend link' }))
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "You've reached the limit of 10 attempts in 15 minutes. Try again in 2 minutes."
      )
    )
    expect(within(dialog).getByText(STEP_UP_EMAIL_WAIT)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Resend in 2:00' })).toBeInTheDocument()
  })

  it('toasts the server’s message when a resend fails, and stays in the wait', async () => {
    dangerRoute(1)
    let refuse = false
    linkRoute(() =>
      refuse
        ? fail('Link requests are paused.', 503)
        : ok({ resendAvailableAt: new Date(Date.now() - 1_000).toISOString() }, 'Sent.', 202)
    )
    const error = vi.spyOn(toast, 'error')
    const user = userEvent.setup()
    renderHarness()
    const dialog = await sendLink(user)
    refuse = true
    await user.click(within(dialog).getByRole('button', { name: 'Resend link' }))
    await waitFor(() => expect(error).toHaveBeenCalledWith('Link requests are paused.'))
    expect(within(dialog).getByText(STEP_UP_EMAIL_WAIT)).toBeInTheDocument()
  })

  it('counts the link’s 15 minutes from when the API sent it, after a cooldown', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    dangerRoute(1)
    // The cooldown has 42 of its 60 seconds left, so the link went out 18 seconds ago.
    linkRoute(() => tooMany('Check your inbox.', 'STEP_UP_LINK_COOLDOWN', 42))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderHarness()
    const dialog = await sendLink(user)
    await act(() => vi.advanceTimersByTimeAsync(15 * 60_000 - 18_000 - 1_000))
    expect(within(dialog).queryByText(EXPIRED)).not.toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(within(dialog).getByText(EXPIRED)).toBeInTheDocument()
  })

  it('says the link expired after 15 minutes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    dangerRoute(1)
    linkRoute()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderHarness()
    const dialog = await sendLink(user)
    await act(() => vi.advanceTimersByTimeAsync(15 * 60_000 - 1_000))
    expect(within(dialog).queryByText(EXPIRED)).not.toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(within(dialog).getByText(EXPIRED)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Resend link' })).toBeInTheDocument()
    expect(screen.getByText('outcome: idle')).toBeInTheDocument()
  })

  it('refreshes, then retries the action once, on step_up_confirmed', async () => {
    const calls = dangerRoute(1)
    linkRoute()
    refreshRoute()
    const user = userEvent.setup()
    renderHarness()
    const dialog = await sendLink(user)

    confirmFromAnotherTab()

    expect(await screen.findByText('outcome: done')).toBeInTheDocument()
    expect(events).toEqual(['action', 'link', 'refresh', 'action'])
    expect(calls).toHaveLength(2)
    expect(calls[1]).toBe(`Bearer ${useAuthStore.getState().accessToken}`)
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  })

  it('stays open with Try again when the refresh fails', async () => {
    dangerRoute(1)
    linkRoute()
    let refuse = true
    refreshRoute(() =>
      refuse ? fail('Service unavailable', 503) : ok({ accessToken: freshlyConfirmedToken() })
    )
    const user = userEvent.setup()
    renderHarness()
    const dialog = await sendLink(user)

    confirmFromAnotherTab()

    expect(await within(dialog).findByText(RESUME_FAILED)).toBeInTheDocument()
    expect(screen.getByText('outcome: idle')).toBeInTheDocument()
    expect(events).toEqual(['action', 'link', 'refresh'])
    expect(useAuthStore.getState().isAuthenticated).toBe(true)

    refuse = false
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('outcome: done')).toBeInTheDocument()
    expect(events).toEqual(['action', 'link', 'refresh', 'refresh', 'action'])
  })

  it('sends a tab whose refresh is refused to /login', async () => {
    dangerRoute(1)
    linkRoute()
    refreshRoute(() =>
      fail('This session ended. Sign in again to continue.', 401, 'ACCESS_TOKEN_EXPIRED')
    )
    const assign = vi.fn()
    const { origin, protocol, host, hostname, port } = window.location
    const user = userEvent.setup()
    renderHarness()
    await sendLink(user)
    // jsdom's Location accessors live on the prototype, so a spread copies none of them.
    vi.stubGlobal('location', {
      origin,
      protocol,
      host,
      hostname,
      port,
      href: `${origin}/tenants`,
      pathname: '/tenants',
      search: '',
      hash: '',
      assign,
    })

    confirmFromAnotherTab()

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login?redirect=%2Ftenants'))
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(events).toEqual(['action', 'link', 'refresh'])
  })

  it('ignores a step_up_confirmed whose refresh brings no new auth_time', async () => {
    const signedInAt = 1_760_000_000
    useAuthStore.setState({ accessToken: testJwt({ auth_time: signedInAt }) })
    dangerRoute(1)
    linkRoute()
    refreshRoute(() => ok({ accessToken: testJwt({ auth_time: signedInAt }) }))
    const user = userEvent.setup()
    renderHarness()
    const dialog = await sendLink(user)

    confirmFromAnotherTab()

    // The joined refresh, then one fresh refresh; neither brings a newer auth_time.
    await waitFor(() => expect(events).toEqual(['action', 'link', 'refresh', 'refresh']))
    expect(await within(dialog).findByText(STEP_UP_EMAIL_WAIT)).toBeInTheDocument()
    expect(screen.getByText('outcome: idle')).toBeInTheDocument()

    refreshRoute(() => ok({ accessToken: testJwt({ auth_time: signedInAt + 900 }) }))
    confirmFromAnotherTab()
    expect(await screen.findByText('outcome: done')).toBeInTheDocument()
  })

  it('refreshes once more when the confirmation joined a refresh that was already in flight', async () => {
    const signedInAt = 1_760_000_000
    useAuthStore.setState({ accessToken: testJwt({ auth_time: signedInAt }) })
    dangerRoute(1)
    linkRoute()
    /** Lets the held refresh answer. */
    let releaseHeld = () => {}
    const held = new Promise<void>((resolve) => {
      releaseHeld = resolve
    })
    let refreshes = 0
    refreshRoute(async () => {
      refreshes += 1
      if (refreshes === 1) {
        await held
        return ok({ accessToken: testJwt({ auth_time: signedInAt }) })
      }
      return ok({ accessToken: testJwt({ auth_time: signedInAt + 900 }) })
    })
    const user = userEvent.setup()
    renderHarness()
    await sendLink(user)

    // A refresh this tab started before the server recorded the confirmation.
    const earlier = ensureSession().catch(() => {})
    await waitFor(() => expect(refreshes).toBe(1))
    confirmFromAnotherTab()
    await settle(50, 'the message joins the held refresh; nothing observable until it lands')
    releaseHeld()
    await earlier

    expect(await screen.findByText('outcome: done')).toBeInTheDocument()
    expect(refreshes).toBe(2)
  })

  it('ignores step_up_confirmed on the start and while resuming', async () => {
    dangerRoute(1)
    linkRoute()
    /** Lets the held refresh answer. */
    let releaseHeld = () => {}
    const held = new Promise<void>((resolve) => {
      releaseHeld = resolve
    })
    refreshRoute(async () => {
      await held
      return ok({ accessToken: freshlyConfirmedToken() })
    })
    const user = userEvent.setup()
    renderHarness()
    const dialog = await openStepUp(user)

    confirmFromAnotherTab()
    await settle(100, 'no subscription on the start: absence has no event to wait on')
    expect(events).toEqual(['action'])
    expect(within(dialog).getByText(START_BODY)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Email me a link' }))
    await within(dialog).findByText(STEP_UP_EMAIL_WAIT)
    confirmFromAnotherTab()
    await waitFor(() => expect(events).toEqual(['action', 'link', 'refresh']))
    confirmFromAnotherTab()
    await settle(100, 'a second message while resuming must start nothing')
    releaseHeld()

    expect(await screen.findByText('outcome: done')).toBeInTheDocument()
    expect(events).toEqual(['action', 'link', 'refresh', 'action'])
  })

  it('keeps waiting when the confirm page posted nothing', async () => {
    dangerRoute(1)
    linkRoute()
    const user = userEvent.setup()
    renderHarness()
    const dialog = await sendLink(user)
    await settle(100, 'no message arrives: absence has no event to wait on')
    expect(within(dialog).getByText(STEP_UP_EMAIL_WAIT)).toBeInTheDocument()
    expect(screen.getByText('outcome: idle')).toBeInTheDocument()
    expect(events).toEqual(['action', 'link'])
  })

  it('ignores Escape while waiting and dismisses only on Cancel', async () => {
    const calls = dangerRoute(1)
    linkRoute()
    const user = userEvent.setup()
    renderHarness()
    const dialog = await sendLink(user)

    await user.keyboard('{Escape}')
    expect(within(dialog).getByText(STEP_UP_EMAIL_WAIT)).toBeInTheDocument()
    expect(screen.getByText('outcome: idle')).toBeInTheDocument()

    await user.click(backdrop())
    await settle(50, 'a dismissal that does not happen has no event to wait on')
    expect(within(dialog).getByText(STEP_UP_EMAIL_WAIT)).toBeInTheDocument()
    expect(screen.getByText('outcome: idle')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('outcome: failed')).toBeInTheDocument()
    expect(calls).toHaveLength(1)
  })

  it('retries only once: a second REAUTH_REQUIRED fails instead of reopening', async () => {
    const calls = dangerRoute(2)
    linkRoute()
    refreshRoute()
    const user = userEvent.setup()
    renderHarness()
    const dialog = await sendLink(user)
    confirmFromAnotherTab()
    expect(await screen.findByText('outcome: failed')).toBeInTheDocument()
    expect(calls).toHaveLength(2)
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('StepUpDialog: the wait lock', () => {
  it('holds the wait lock while waiting and releases it on finish', async () => {
    const locks = stubWebLocks()
    dangerRoute(1)
    linkRoute()
    refreshRoute()
    const user = userEvent.setup()
    renderHarness()
    await openStepUp(user)
    expect(holdsWaitLock(locks)).toBe(false)

    const dialog = screen.getByRole('dialog', { name: DIALOG })
    await user.click(within(dialog).getByRole('button', { name: 'Email me a link' }))
    await within(dialog).findByText(STEP_UP_EMAIL_WAIT)
    await waitFor(() => expect(holdsWaitLock(locks)).toBe(true))
    expect(locks.requests).toContainEqual({ name: STEP_UP_WAIT_LOCK, mode: 'shared' })

    confirmFromAnotherTab()

    expect(await screen.findByText('outcome: done')).toBeInTheDocument()
    await waitFor(() => expect(holdsWaitLock(locks)).toBe(false))
  })

  it('releases the wait lock on Cancel', async () => {
    const locks = stubWebLocks()
    dangerRoute(1)
    linkRoute()
    const user = userEvent.setup()
    renderHarness()
    const dialog = await sendLink(user)
    await waitFor(() => expect(holdsWaitLock(locks)).toBe(true))
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('outcome: failed')).toBeInTheDocument()
    await waitFor(() => expect(holdsWaitLock(locks)).toBe(false))
  })

  it('releases the wait lock on unmount', async () => {
    const locks = stubWebLocks()
    dangerRoute(1)
    linkRoute()
    const user = userEvent.setup()
    const { unmount } = renderHarness()
    await sendLink(user)
    await waitFor(() => expect(holdsWaitLock(locks)).toBe(true))
    unmount()
    await waitFor(() => expect(holdsWaitLock(locks)).toBe(false))
  })
})
