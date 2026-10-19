import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PendingInvitations } from '@/components/features/tenant/pending-invitations'
import { toast } from '@/lib/toast'
import { listPage } from '@/tests/fixtures/list-page'
import { fail, INVITATION_SENT_MESSAGE, ok, testInvitation } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { TenantInvitation } from '@/types/api.types'

const RESEND_URL = '/api/v1/tenants/acme/invitations/:id/resend'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Serves the list with one invitation whose `resendAvailableAt` is `inMs` from now (or `null`). */
function serveInvitation(inMs: number | null, overrides: Partial<TenantInvitation> = {}) {
  const invitation: TenantInvitation = {
    ...testInvitation,
    lastSentAt: '2026-10-01T00:00:00.000Z',
    resendAvailableAt: inMs === null ? null : new Date(Date.now() + inMs).toISOString(),
    ...overrides,
  }
  server.use(
    http.get('/api/v1/tenants/acme/invitations', () =>
      ok(listPage([invitation]), 'Invitations retrieved.')
    )
  )
}

/** Counts the resend posts and answers them with `answer`. */
function serveResend(answer: () => Response = () => ok(null, INVITATION_SENT_MESSAGE, 202)) {
  const calls = { count: 0 }
  server.use(
    http.post(RESEND_URL, () => {
      calls.count += 1
      return answer()
    })
  )
  return calls
}

/** Mounts the invitations panel for acme on a router of its own, as `myRole`. */
function renderPanel(myRole: 'owner' | 'admin' = 'owner') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <PendingInvitations slug="acme" myRole={myRole} />,
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
}

const WAITING = 'Resend invitation to invitee@b.com, available in 4 min'
const READY = 'Resend invitation to invitee@b.com'

describe('PendingInvitations resend countdown', () => {
  beforeEach(() => {
    vi.spyOn(toast, 'error')
  })

  it('disables Resend with the minutes left from resendAvailableAt', async () => {
    serveInvitation(4 * 60_000 - 5_000)
    renderPanel()

    const button = await screen.findByRole('button', { name: WAITING })
    expect(button).toHaveTextContent('Resend in 4 min')
    expect(button).toHaveAttribute('aria-disabled', 'true')
  })

  it('keeps the disabled Resend focusable and posts nothing when pressed', async () => {
    serveInvitation(4 * 60_000)
    const calls = serveResend()
    const user = userEvent.setup()
    renderPanel()

    const button = await screen.findByRole('button', { name: WAITING })
    button.focus()
    expect(button).toHaveFocus()
    await user.click(button)
    await user.keyboard('{Enter}')

    expect(calls.count).toBe(0)
  })

  it('keeps the countdown text out of any live region', async () => {
    serveInvitation(4 * 60_000)
    renderPanel()

    const button = await screen.findByRole('button', { name: WAITING })
    expect(button.closest('[aria-live], [role="status"], [role="alert"]')).toBeNull()
  })

  it('enables Resend once the time passes, without a refetch', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    serveInvitation(3_000)
    let listCalls = 0
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () => {
        listCalls += 1
        return ok(
          listPage([
            {
              ...testInvitation,
              lastSentAt: null,
              resendAvailableAt: new Date(Date.now() + 3_000).toISOString(),
            },
          ]),
          'Invitations retrieved.'
        )
      })
    )
    renderPanel()

    expect(
      await screen.findByRole('button', { name: WAITING.replace('4 min', '1 min') })
    ).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100)
    })

    const button = await screen.findByRole('button', { name: READY })
    expect(button).toHaveTextContent('Resend')
    expect(button).not.toHaveAttribute('aria-disabled', 'true')
    expect(listCalls).toBe(1)
  })

  it('counts down from Retry-After after a 429 cooldown', async () => {
    serveInvitation(null)
    serveResend(() =>
      HttpResponse.json(
        {
          success: false,
          message: 'Wait before resending.',
          statusCode: 429,
          code: 'invitation_resend_cooldown',
          requestId: 'r',
        },
        { status: 429, headers: { 'Retry-After': '300' } }
      )
    )
    const user = userEvent.setup()
    renderPanel()

    await user.click(await screen.findByRole('button', { name: READY }))

    expect(
      await screen.findByRole('button', {
        name: 'Resend invitation to invitee@b.com, available in 5 min',
      })
    ).toHaveTextContent('Resend in 5 min')
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Wait before resending.')
    })
  })

  it('keeps the grant-rule reason over the countdown', async () => {
    serveInvitation(4 * 60_000, { role: 'owner' })
    renderPanel('admin')

    const button = await screen.findByRole('button', { name: READY })
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Resend')
    expect(button).not.toHaveTextContent('Resend in')
    expect(button).toHaveAccessibleDescription(
      'Only an owner can resend or revoke an invitation for this role.'
    )
  })

  it('treats a null resendAvailableAt as available', async () => {
    serveInvitation(null)
    const calls = serveResend()
    const user = userEvent.setup()
    renderPanel()

    const button = await screen.findByRole('button', { name: READY })
    expect(button).toHaveTextContent('Resend')
    expect(button).not.toHaveTextContent('NaN')
    await user.click(button)

    await waitFor(() => {
      expect(calls.count).toBe(1)
    })
  })

  it('shows the server message for a non-cooldown refusal and starts no countdown', async () => {
    serveInvitation(null)
    serveResend(() => fail('You cannot manage an invitation for that role.', 403))
    const user = userEvent.setup()
    renderPanel()

    await user.click(await screen.findByRole('button', { name: READY }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('You cannot manage an invitation for that role.')
    })
    expect(screen.getByRole('button', { name: READY })).toBeInTheDocument()
  })
})
