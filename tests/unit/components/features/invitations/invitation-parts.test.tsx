import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InvitationInbox } from '@/components/features/invitations/invitation-parts'
import { landJoined } from '@/components/features/invitations/land-joined'
import { ensureSession, resetSessionForTests, subscribeAuthMessage } from '@/http/session'
import { toast } from '@/lib/toast'
import { PII_CLASS_NAME } from '@/observability/telemetry'
import { useAuthStore } from '@/states/auth.store'
import { testUser } from '@/tests/mocks/handlers'

vi.mock('@/http/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/http/session')>()),
  ensureSession: vi.fn(),
}))

/** Renders `node` as the only route of a bare router, since the parts draw router links. */
async function renderInRouter(node: ReactNode) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => node }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(<RouterProvider router={router} />)
  await act(() => router.load())
}

beforeEach(() => {
  resetSessionForTests()
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

/** Renders the inbox waiting on a link, with `onSignedIn` as the page's handler. */
async function renderInbox(onSignedIn = vi.fn()) {
  await renderInRouter(
    <InvitationInbox
      email="ada@example.test"
      tenantName="Acme"
      resendAt={Date.now() + 60_000}
      resending={false}
      onResend={vi.fn()}
      onSignedIn={onSignedIn}
    />
  )
  return onSignedIn
}

/** Posts `signed_in` as another tab would. */
function postFromAnotherTab() {
  const otherTab = new BroadcastChannel('auth')
  otherTab.postMessage({ type: 'signed_in' })
  otherTab.close()
}

/**
 * Posts `signed_in` from another tab and waits until a listener registered
 * after the inbox's has heard it: the channel delivers in order, so by then
 * the inbox has made its choice.
 */
async function postAndWait() {
  const heard = vi.fn()
  const stop = subscribeAuthMessage('signed_in', heard)
  postFromAnotherTab()
  await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1))
  stop()
}

/** A session restore that settles only when the test calls `restore`. */
function heldRestore() {
  let resolveRestore: ((token: string) => void) | null = null
  const restored = new Promise<string>((resolve) => {
    resolveRestore = resolve
  })
  return { restored, restore: (token: string) => resolveRestore?.(token) }
}

describe('InvitationInbox', () => {
  it('names the mailed address masked, the workspace and the link’s rules, and takes focus on Resend', async () => {
    await renderInRouter(
      <InvitationInbox
        email="ada@example.test"
        tenantName="Acme"
        resendAt={Date.now() + 60_000}
        resending={false}
        onResend={vi.fn()}
        onSignedIn={vi.fn()}
      />
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Check your inbox' })).toBeVisible()
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('We sent a link to ada@example.test.')
    expect(screen.getByText('ada@example.test')).toHaveClass(PII_CLASS_NAME)
    expect(
      screen.getByText('Open it to join Acme. The link works once and expires in 15 minutes.')
    ).toBeVisible()
    const resend = screen.getByRole('button', { name: 'Resend in 1:00' })
    expect(resend).toHaveFocus()
    expect(resend).toHaveAttribute('aria-describedby', status.id)
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/')
  })

  it('holds Resend until the countdown ends, then calls onResend', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    const onResend = vi.fn()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderInRouter(
      <InvitationInbox
        email="ada@example.test"
        tenantName="Acme"
        resendAt={Date.now() + 42_000}
        resending={false}
        onResend={onResend}
        onSignedIn={vi.fn()}
      />
    )

    const resend = screen.getByRole('button', { name: 'Resend in 0:42' })
    expect(resend).toHaveAttribute('aria-disabled', 'true')
    await user.click(resend)
    expect(onResend).not.toHaveBeenCalled()

    await act(() => vi.advanceTimersByTimeAsync(42_000))
    await user.click(screen.getByRole('button', { name: 'Resend link' }))
    expect(onResend).toHaveBeenCalledOnce()
  })
})

describe('InvitationInbox, when another tab signs in', () => {
  it('restores the session once for a burst of messages, then calls onSignedIn', async () => {
    const order: string[] = []
    vi.mocked(ensureSession).mockImplementation(() => {
      order.push('ensureSession')
      return Promise.resolve('access-token')
    })
    const onSignedIn = await renderInbox(vi.fn(() => order.push('onSignedIn')))

    postFromAnotherTab()
    postFromAnotherTab()

    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledOnce())
    expect(ensureSession).toHaveBeenCalledOnce()
    expect(order).toEqual(['ensureSession', 'onSignedIn'])
  })

  it('stays on the inbox when the restore fails, and tries again on the next message', async () => {
    vi.mocked(ensureSession).mockRejectedValueOnce(new Error('refresh failed'))
    vi.mocked(ensureSession).mockResolvedValueOnce('access-token')
    const onSignedIn = await renderInbox()

    await postAndWait()
    await vi.waitFor(() => expect(ensureSession).toHaveBeenCalledOnce())
    expect(onSignedIn).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { level: 1, name: 'Check your inbox' })).toBeVisible()

    postFromAnotherTab()
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledOnce())
    expect(ensureSession).toHaveBeenCalledTimes(2)
  })

  it('ignores it in a tab that is already signed in', async () => {
    const onSignedIn = await renderInbox()
    useAuthStore.getState().login('access-token', testUser)

    await postAndWait()

    expect(ensureSession).not.toHaveBeenCalled()
    expect(onSignedIn).not.toHaveBeenCalled()
  })

  it('does not move on when the restore settles after unmount', async () => {
    const { restored, restore } = heldRestore()
    vi.mocked(ensureSession).mockReturnValue(restored)
    const onSignedIn = await renderInbox()

    postFromAnotherTab()
    await vi.waitFor(() => expect(ensureSession).toHaveBeenCalledOnce())
    cleanup()
    // Settling the restore is the barrier: its then-callbacks run inside this act.
    await act(async () => {
      restore('access-token')
      await restored
    })

    expect(onSignedIn).not.toHaveBeenCalled()
  })

  it('stops listening once unmounted', async () => {
    const onSignedIn = await renderInbox()
    cleanup()

    await postAndWait()

    expect(ensureSession).not.toHaveBeenCalled()
    expect(onSignedIn).not.toHaveBeenCalled()
  })
})

describe('landJoined', () => {
  it('toasts the join with the account, then opens the tenant', () => {
    const success = vi.spyOn(toast, 'success')
    const open = vi.fn()

    landJoined({ name: 'Acme', slug: 'acme' }, 'ada@example.test', false, open)

    expect(success).toHaveBeenCalledWith('You joined Acme as ada@example.test.')
    expect(open).toHaveBeenCalledWith({ name: 'Acme', slug: 'acme' })
    expect(success.mock.invocationCallOrder[0]).toBeLessThan(open.mock.invocationCallOrder[0] ?? 0)
  })

  it('says so when the caller had joined already', () => {
    const success = vi.spyOn(toast, 'success')

    landJoined({ name: 'Acme', slug: 'acme' }, 'ada@example.test', true, vi.fn())

    expect(success).toHaveBeenCalledWith("You've already joined Acme as ada@example.test.")
  })
})
