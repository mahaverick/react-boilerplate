import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHECK_INBOX_TITLE,
  LINK_DEAD_TITLE,
  RESEND_COOLDOWN_SECONDS,
  SignInLinkForm,
} from '@/components/features/auth/sign-in-link-form'
import { ensureSession, resetSessionForTests, subscribeAuthMessage } from '@/http/session'
import { toast } from '@/lib/toast'
import { PII_CLASS_NAME, track } from '@/observability/telemetry'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

vi.mock('@/observability/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/observability/telemetry')>()),
  track: vi.fn(),
}))

vi.mock('@/http/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/http/session')>()),
  ensureSession: vi.fn(),
}))

const REQUEST_URL = '/api/v1/auth/link/request'

/** The bodies the link-request endpoint received, in order; it answers 202 unless `answer` says otherwise. */
function serveRequests(answer?: () => Response) {
  const bodies: unknown[] = []
  server.use(
    http.post(REQUEST_URL, async ({ request }) => {
      bodies.push(await request.json())
      return answer?.() ?? ok(null, 'Check your inbox for a sign-in link.', 202)
    })
  )
  return bodies
}

/** What the host page passes beside the `sentTo` it owns. */
interface HostProps {
  submitLabel?: string
  defaultEmail?: string
  redirect?: string
  onSignedIn?: () => void
}

/**
 * A page that owns `sentTo` and titles its card from it, as `/login` and the
 * dead-link pages do: `LINK_DEAD_TITLE` or "Sign in" until a link is sent,
 * then `CHECK_INBOX_TITLE`.
 */
function renderForm({ onSignedIn = vi.fn(), ...props }: HostProps = {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const before = props.submitLabel ? LINK_DEAD_TITLE : 'Sign in'

  /** The page around the form. */
  function Host() {
    const [sentTo, setSentTo] = useState<string | null>(null)
    return (
      <QueryClientProvider client={client}>
        <main>
          <h1>{sentTo ? CHECK_INBOX_TITLE : before}</h1>
          <SignInLinkForm
            sentTo={sentTo}
            onSentToChange={setSentTo}
            onSignedIn={onSignedIn}
            {...props}
          />
        </main>
      </QueryClientProvider>
    )
  }

  render(<Host />)
  return { onSignedIn }
}

/** Types `email` into the field and submits the form with the button labelled `submit`. */
async function send(
  user: ReturnType<typeof userEvent.setup>,
  email = 'ada@example.test',
  submit = 'Email me a sign-in link'
) {
  await user.type(screen.getByLabelText('Email'), email)
  await user.click(screen.getByRole('button', { name: submit }))
}

/** Waits for the check-inbox state's status line. */
function sentLine() {
  return screen.findByText(/We sent a sign-in link to/)
}

beforeEach(() => {
  resetSessionForTests()
  vi.mocked(track).mockReset()
  vi.mocked(ensureSession).mockReset()
  useAuthStore.setState({
    accessToken: null,
    user: null,
    isAuthenticated: false,
    isBootstrapped: true,
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('SignInLinkForm', () => {
  it('pins the titles and the cooldown the pages share', () => {
    expect(CHECK_INBOX_TITLE).toBe('Check your inbox')
    expect(LINK_DEAD_TITLE).toBe('This link has expired or was already used')
    expect(RESEND_COOLDOWN_SECONDS).toBe(60)
  })

  it('sends the trimmed, lowercased address and shows Check your inbox', async () => {
    const bodies = serveRequests()
    const user = userEvent.setup()
    renderForm({ redirect: '/tenants/acme' })

    await send(user, '  Ada@Example.TEST ')

    const line = await sentLine()
    expect(line).toHaveAttribute('role', 'status')
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ email: 'ada@example.test', redirect: '/tenants/acme' })
    const address = screen.getByText('ada@example.test')
    expect(line).toContainElement(address)
    expect(address).toHaveClass(PII_CLASS_NAME)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(CHECK_INBOX_TITLE)
    expect(screen.getByText('The link works once and expires in 15 minutes.')).toBeVisible()
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
    // The submit button is gone, so the resend button that took its place holds focus.
    expect(screen.getByRole('button', { name: /^Resend in/ })).toHaveFocus()
  })

  it('tracks sign_in_link_requested once per send', async () => {
    serveRequests()
    const user = userEvent.setup()
    renderForm()

    await send(user)
    await sentLine()
    expect(vi.mocked(track).mock.calls).toEqual([['sign_in_link_requested']])
  })

  it('does not track or leave the form when the request fails', async () => {
    serveRequests(() => fail('Too many requests. Try again in 60 seconds.', 429))
    const user = userEvent.setup()
    renderForm()

    await send(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many requests. Try again in 60 seconds.'
    )
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(track).not.toHaveBeenCalled()
  })

  it('disables resend for 60 seconds with a live countdown', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    const bodies = serveRequests()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderForm()

    await send(user)
    await sentLine()

    const waiting = screen.getByRole('button', { name: 'Resend in 1:00' })
    expect(waiting).toHaveAttribute('aria-disabled', 'true')
    // The clock is not announced every second: it sits outside the status line.
    expect(waiting.closest('[role="status"], [aria-live]')).toBeNull()

    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(screen.getByRole('button', { name: 'Resend in 0:59' })).toBeInTheDocument()

    await act(() => vi.advanceTimersByTimeAsync((RESEND_COOLDOWN_SECONDS - 1) * 1_000))
    const resend = screen.getByRole('button', { name: 'Resend link' })
    expect(resend).not.toHaveAttribute('aria-disabled', 'true')

    await user.click(resend)
    await act(() => vi.advanceTimersByTimeAsync(0))
    await vi.waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1]).toMatchObject({ email: 'ada@example.test' })
    vi.useRealTimers()
    expect(await screen.findByRole('button', { name: 'Resend in 1:00' })).toBeInTheDocument()
    expect(track).toHaveBeenCalledTimes(2)
  })

  it('extends the countdown to Retry-After on a 429', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    let refuse = false
    serveRequests(() =>
      refuse
        ? HttpResponse.json(
            {
              success: false,
              message: 'Too many requests. Try again in 2 minutes.',
              statusCode: 429,
              requestId: 'test-request-id',
            },
            { status: 429, headers: { 'Retry-After': '120' } }
          )
        : ok(null, 'Check your inbox for a sign-in link.', 202)
    )
    const error = vi.spyOn(toast, 'error')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderForm()

    await send(user)
    await sentLine()
    await act(() => vi.advanceTimersByTimeAsync(RESEND_COOLDOWN_SECONDS * 1_000))
    refuse = true
    await user.click(screen.getByRole('button', { name: 'Resend link' }))

    vi.useRealTimers()
    expect(await screen.findByRole('button', { name: 'Resend in 2:00' })).toBeInTheDocument()
    expect(error).toHaveBeenCalledWith('Too many requests. Try again in 2 minutes.')
    // Still waiting on the inbox: the address and the link's rules stay on screen.
    expect(screen.getByText(/We sent a sign-in link to/)).toBeInTheDocument()
  })

  it('toasts a resend failure and leaves resend open when the server names no wait', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    let refuse = false
    serveRequests(() =>
      refuse
        ? fail('Something went wrong.', 500)
        : ok(null, 'Check your inbox for a sign-in link.', 202)
    )
    const error = vi.spyOn(toast, 'error')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderForm()

    await send(user)
    await sentLine()
    await act(() => vi.advanceTimersByTimeAsync(RESEND_COOLDOWN_SECONDS * 1_000))
    refuse = true
    await user.click(screen.getByRole('button', { name: 'Resend link' }))

    vi.useRealTimers()
    await waitFor(() => expect(error).toHaveBeenCalledWith('Something went wrong.'))
    expect(screen.getByRole('button', { name: 'Resend link' })).not.toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })

  it('puts a 400 errors.email under the field', async () => {
    serveRequests(() =>
      HttpResponse.json(
        {
          success: false,
          message: 'Validation failed',
          statusCode: 400,
          errors: { email: ['Enter a valid email address.'] },
          requestId: 'test-request-id',
        },
        { status: 400 }
      )
    )
    const user = userEvent.setup()
    renderForm()

    await send(user)

    const field = screen.getByLabelText('Email')
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'))
    expect(field).toHaveAccessibleDescription('Enter a valid email address.')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('returns to the form with the address kept on Use a different email', async () => {
    serveRequests()
    const user = userEvent.setup()
    renderForm()

    await send(user, ' Ada@Example.TEST')
    await sentLine()
    await user.click(screen.getByRole('button', { name: 'Use a different email' }))

    const field = screen.getByLabelText('Email')
    expect(field).toHaveValue('ada@example.test')
    expect(field).toHaveFocus()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sign in')
  })

  it('offers a new link on a dead-link page with no address or redirect', async () => {
    const bodies = serveRequests()
    const user = userEvent.setup()
    renderForm({ submitLabel: 'Email me a new link' })

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(LINK_DEAD_TITLE)
    expect(screen.getByLabelText('Email')).toHaveValue('')
    await send(user, 'ada@example.test', 'Email me a new link')

    await sentLine()
    // Each app's query adds its own `app`; the form adds no redirect it was not given.
    expect(bodies[0]).toMatchObject({ email: 'ada@example.test' })
    expect(bodies[0]).not.toHaveProperty('redirect')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(CHECK_INBOX_TITLE)
  })

  it('prefills the address it is given', () => {
    renderForm({ defaultEmail: 'ada@example.test', submitLabel: 'Email me a new link' })

    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.test')
  })

  it('moves on when another tab signs in', async () => {
    serveRequests()
    const order: string[] = []
    vi.mocked(ensureSession).mockImplementation(() => {
      order.push('ensureSession')
      return Promise.resolve('access-token')
    })
    const onSignedIn = vi.fn(() => order.push('onSignedIn'))
    const user = userEvent.setup()
    renderForm({ onSignedIn })
    await send(user)
    await sentLine()

    const otherTab = new BroadcastChannel('auth')
    otherTab.postMessage({ type: 'signed_in' })

    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1))
    expect(ensureSession).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['ensureSession', 'onSignedIn'])
    otherTab.close()
  })

  it('stays on the inbox when the session cannot be restored', async () => {
    serveRequests()
    vi.mocked(ensureSession).mockRejectedValue(new Error('refresh failed'))
    const onSignedIn = vi.fn()
    const user = userEvent.setup()
    renderForm({ onSignedIn })
    await send(user)
    await sentLine()

    const otherTab = new BroadcastChannel('auth')
    otherTab.postMessage({ type: 'signed_in' })

    await vi.waitFor(() => expect(ensureSession).toHaveBeenCalledTimes(1))
    expect(onSignedIn).not.toHaveBeenCalled()
    expect(screen.getByText(/We sent a sign-in link to/)).toBeInTheDocument()
    otherTab.close()
  })

  describe('ignores signed_in while signed in or before a link was sent', () => {
    /**
     * Posts `signed_in` from another tab and waits until a listener this test
     * registered after the form's has heard it: the channel delivers to its
     * listeners in order, so by then the form has made its choice.
     */
    async function postAndWait() {
      const heard = vi.fn()
      const stop = subscribeAuthMessage('signed_in', heard)
      const otherTab = new BroadcastChannel('auth')
      otherTab.postMessage({ type: 'signed_in' })
      await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1))
      stop()
      otherTab.close()
    }

    it('ignores it in a tab that is already signed in', async () => {
      serveRequests()
      const onSignedIn = vi.fn()
      const user = userEvent.setup()
      renderForm({ onSignedIn })
      await send(user)
      await sentLine()
      useAuthStore.getState().login('access-token', testUser)

      await postAndWait()

      expect(ensureSession).not.toHaveBeenCalled()
      expect(onSignedIn).not.toHaveBeenCalled()
    })

    it('ignores it before a link was sent', async () => {
      const onSignedIn = vi.fn()
      renderForm({ onSignedIn })

      await postAndWait()

      expect(ensureSession).not.toHaveBeenCalled()
      expect(onSignedIn).not.toHaveBeenCalled()
    })
  })
})
