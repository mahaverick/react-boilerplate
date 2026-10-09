import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { authKeys } from '@/queries/auth.queries'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const LINKED_AT = '2026-01-01T00:00:00.000Z'

/** The section renders inside the real /profile route, as a user reaches it. */
function renderProfile() {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ['/profile'] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return router
}

function mockProviders(providers: string[], hasPassword: boolean) {
  server.use(
    http.get('/api/v1/auth/providers', () =>
      ok(
        {
          providers: providers.map((provider) => ({ provider, linkedAt: LINKED_AT })),
          hasPassword,
        },
        'Auth providers retrieved.'
      )
    )
  )
}

async function section() {
  return within(await screen.findByRole('region', { name: 'Security' }))
}

async function fillAndSubmit(current: string, next: string, confirm = next) {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Current password'), current)
  await user.type(screen.getByLabelText('New password'), next)
  await user.type(screen.getByLabelText('Confirm new password'), confirm)
  await user.click(screen.getByRole('button', { name: 'Change password' }))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('security section', () => {
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
  })

  it('lists a password and Google, and never the raw email row', async () => {
    mockProviders(['email', 'google'], true)
    renderProfile()

    const security = await section()
    expect(await security.findByText('Email & password')).toBeInTheDocument()
    expect(security.getByText('Google')).toBeInTheDocument()
    expect(security.queryByText('email')).not.toBeInTheDocument()
  })

  it('shows an unrecognised provider by its own name', async () => {
    mockProviders(['email', 'github'], true)
    renderProfile()

    expect(await (await section()).findByText('github')).toBeInTheDocument()
  })

  it('replaces the form with a note on a Google-only account', async () => {
    // A Google sign-up has an 'email' row too; `hasPassword` is what decides.
    mockProviders(['email', 'google'], false)
    renderProfile()

    const security = await section()
    expect(
      await security.findByText(
        'This account signs in with Google only. To add a password, use Forgot password on the sign-in page.'
      )
    ).toBeInTheDocument()
    expect(security.getByText('Google')).toBeInTheDocument()
    expect(security.queryByText('Email & password')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument()
  })

  it('refuses a mismatched confirmation without touching the network', async () => {
    let called = false
    server.use(
      http.post('/api/v1/auth/change-password', () => {
        called = true
        return ok(null, 'Password has been changed.')
      })
    )
    renderProfile()
    await fillAndSubmit('old-password', 'longenough8', 'different99')

    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument()
    expect(called).toBe(false)
  })

  it('holds the new password to the registration rule', async () => {
    let called = false
    server.use(
      http.post('/api/v1/auth/change-password', () => {
        called = true
        return ok(null, 'Password has been changed.')
      })
    )
    renderProfile()
    await fillAndSubmit('old-password', 'short')

    expect(
      await screen.findByText('Password must be at least 8 characters long.')
    ).toBeInTheDocument()
    expect(called).toBe(false)
  })

  it('posts only the two passwords, confirms, and clears the form', async () => {
    let body: unknown
    server.use(
      http.post('/api/v1/auth/change-password', async ({ request }) => {
        body = await request.json()
        return ok(null, 'Password has been changed.')
      })
    )
    renderProfile()
    await fillAndSubmit('old-password', 'longenough8')

    expect(
      await screen.findByText('Password changed. Other sessions were signed out.')
    ).toBeInTheDocument()
    expect(body).toEqual({ currentPassword: 'old-password', newPassword: 'longenough8' })
    await waitFor(() => {
      expect(screen.getByLabelText('Current password')).toHaveValue('')
    })
    expect(screen.getByLabelText('New password')).toHaveValue('')
    expect(screen.getByLabelText('Confirm new password')).toHaveValue('')
  })

  it('puts a wrong current password on that field, once, with no toast', async () => {
    const toastError = vi.spyOn(toast, 'error')
    server.use(
      http.post('/api/v1/auth/change-password', () => fail('Current password is incorrect.', 400))
    )
    renderProfile()
    await fillAndSubmit('wrong-password', 'longenough8')

    const current = screen.getByLabelText('Current password')
    await waitFor(() => {
      expect(current).toHaveAccessibleDescription('Current password is incorrect.')
    })
    expect(current).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getAllByText('Current password is incorrect.')).toHaveLength(1)
    expect(toastError).not.toHaveBeenCalled()
  })

  it('puts an unchanged password on the new-password field', async () => {
    server.use(
      http.post('/api/v1/auth/change-password', () =>
        fail('New password must be different from the current password.', 400)
      )
    )
    renderProfile()
    await fillAndSubmit('longenough8', 'longenough8')

    await waitFor(() => {
      expect(screen.getByLabelText('New password')).toHaveAccessibleDescription(
        'New password must be different from the current password.'
      )
    })
  })

  it("maps the server's field errors onto their fields", async () => {
    server.use(
      http.post('/api/v1/auth/change-password', () =>
        HttpResponse.json(
          {
            success: false,
            message: 'Validation failed',
            statusCode: 400,
            errors: { newPassword: ['Password is too long.'] },
            requestId: 'test-request-id',
          },
          { status: 400 }
        )
      )
    )
    renderProfile()
    await fillAndSubmit('old-password', 'longenough8')

    await waitFor(() => {
      expect(screen.getByLabelText('New password')).toHaveAccessibleDescription(
        'Password is too long.'
      )
    })
    expect(screen.queryByText('Validation failed')).not.toBeInTheDocument()
  })

  it('shows a rate-limited attempt at form level, against no field', async () => {
    server.use(
      http.post('/api/v1/auth/change-password', () =>
        fail('Too many attempts. Please try again later.', 429, 'RATE_LIMITED')
      )
    )
    renderProfile()
    await fillAndSubmit('old-password', 'longenough8')

    const message = await screen.findByText('Too many attempts. Please try again later.')
    expect(message.closest('[role="alert"]')).not.toBeNull()
    expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'false')
  })

  it('offers a retry when the sign-in methods fail to load', async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/auth/providers', () => {
        calls += 1
        // Two failures: the router's client retries once by itself.
        return calls <= 2
          ? fail('Something went wrong.', 500)
          : ok(
              { providers: [{ provider: 'email', linkedAt: LINKED_AT }], hasPassword: true },
              'Auth providers retrieved.'
            )
      })
    )
    const user = userEvent.setup()
    renderProfile()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('We could not load your sign-in methods.')
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByLabelText('Current password')).toBeInTheDocument()
  })

  it('keeps this device signed in after a successful change', async () => {
    const toastSuccess = vi.spyOn(toast, 'success')
    mockProviders(['email'], true)
    server.use(http.post('/api/v1/auth/change-password', () => ok(null, 'Password changed.')))
    let refreshCalls = 0
    server.use(
      http.post('/api/v1/auth/refresh', () => {
        refreshCalls += 1
        return ok({ accessToken: 'fresh-token' }, 'Token refreshed.')
      })
    )
    const router = renderProfile()
    await fillAndSubmit('old-passphrase-1', 'new-passphrase-2')

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect(useAuthStore.getState().accessToken).toBe('access-token')
    expect(await screen.findByRole('region', { name: 'Security' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/profile')
    // The next request still succeeds.
    await act(() => queryClient.refetchQueries({ queryKey: authKeys.providers }))
    expect(queryClient.getQueryState(authKeys.providers)?.status).toBe('success')
    // A successful password change keeps this device's own access token; it must never trigger a refresh to get there.
    expect(refreshCalls).toBe(0)
  })
})

describe('sign out other sessions', () => {
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
  })

  /** Answers the revoke with `revoked`, recording each request's body and content type. */
  function mockRevokeOthers(revoked: number) {
    const requests: { body: unknown; contentType: string | null }[] = []
    server.use(
      http.post('/api/v1/auth/sessions/revoke-others', async ({ request }) => {
        requests.push({
          body: await request.json(),
          contentType: request.headers.get('content-type'),
        })
        return ok({ revoked }, 'Other sessions signed out.')
      })
    )
    return requests
  }

  it('posts an empty JSON body and says how many sessions it ended', async () => {
    mockProviders(['email'], true)
    const requests = mockRevokeOthers(2)
    const user = userEvent.setup()
    renderProfile()

    const security = await section()
    await user.click(await security.findByRole('button', { name: 'Sign out other sessions' }))

    expect(await screen.findByText('Signed out 2 other sessions.')).toBeInTheDocument()
    expect(requests).toHaveLength(1)
    expect(requests[0]?.body).toEqual({})
    expect(requests[0]?.contentType).toContain('application/json')
  })

  it('says one session in the singular, and none when there were none', async () => {
    mockProviders(['email'], true)
    mockRevokeOthers(1)
    const user = userEvent.setup()
    renderProfile()

    const button = await (await section()).findByRole('button', { name: 'Sign out other sessions' })
    await user.click(button)
    expect(await screen.findByText('Signed out 1 other session.')).toBeInTheDocument()

    mockRevokeOthers(0)
    await user.click(button)
    expect(await screen.findByText('No other sessions were signed in.')).toBeInTheDocument()
  })

  it('is offered on a Google-only account too', async () => {
    mockProviders(['email', 'google'], false)
    renderProfile()

    expect(
      await (await section()).findByRole('button', { name: 'Sign out other sessions' })
    ).toBeEnabled()
  })

  it('shows the server’s message when it is refused', async () => {
    mockProviders(['email'], true)
    server.use(
      http.post('/api/v1/auth/sessions/revoke-others', () =>
        fail('Too many attempts. Please try again later.', 429, 'RATE_LIMITED')
      )
    )
    const user = userEvent.setup()
    renderProfile()

    await user.click(
      await (await section()).findByRole('button', { name: 'Sign out other sessions' })
    )
    expect(
      await screen.findByText('Too many attempts. Please try again later.')
    ).toBeInTheDocument()
  })
})
