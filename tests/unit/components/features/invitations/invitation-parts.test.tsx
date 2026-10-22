import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { InvitationInbox } from '@/components/features/invitations/invitation-parts'
import { landJoined } from '@/components/features/invitations/land-joined'
import { ensureSession, resetSessionForTests } from '@/http/session'
import { toast } from '@/lib/toast'
import { PII_CLASS_NAME } from '@/observability/telemetry'
import { useAuthStore } from '@/states/auth.store'

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

describe('InvitationInbox', () => {
  it('names the mailed address masked, the workspace and the link’s rules, and takes focus on Resend', async () => {
    await renderInRouter(
      <InvitationInbox
        email="ada@example.test"
        tenantName="Acme"
        resendAt={Date.now() + 60_000}
        resending={false}
        onResend={vi.fn()}
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

    expect(success).toHaveBeenCalledWith('You’ve already joined Acme as ada@example.test.')
  })
})
