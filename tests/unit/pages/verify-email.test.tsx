import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

function renderAt(path: string): AnyRouter {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return router as AnyRouter
}

describe('verify-email page', () => {
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
    server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
  })

  /** The password is NOT optional here — the backend requires it. */
  it('posts the token from the link together with the password', async () => {
    let body: unknown
    server.use(
      http.post('/api/v1/auth/verify-email', async ({ request }) => {
        body = await request.json()
        return ok(null, 'Email verified.')
      })
    )
    renderAt('/verify-email?token=tok-abc')

    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Password'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Verify email' }))

    await waitFor(() => {
      expect(body).toEqual({ token: 'tok-abc', password: 'secret123' })
    })
  })

  it('will not submit a token without the account password', async () => {
    let called = false
    server.use(
      http.post('/api/v1/auth/verify-email', () => {
        called = true
        return ok(null, 'Email verified.')
      })
    )
    renderAt('/verify-email?token=tok-abc')

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Verify email' }))

    expect(await screen.findByText('Password is required.')).toBeInTheDocument()
    expect(called).toBe(false)
  })

  it('offers a resend form once verification has failed', async () => {
    server.use(http.post('/api/v1/auth/verify-email', () => fail('That link has expired.', 400)))
    let resendBody: unknown
    server.use(
      http.post('/api/v1/auth/resend-verification', async ({ request }) => {
        resendBody = await request.json()
        return ok(null, 'Sent.')
      })
    )
    renderAt('/verify-email?token=expired-token')

    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Password'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Verify email' }))

    await user.type(await screen.findByLabelText('Email'), '  ADA@B.COM  ')
    await user.click(screen.getByRole('button', { name: 'Resend verification email' }))

    await waitFor(() => {
      // Normalised by the schema on the way out, like every other address.
      expect(resendBody).toEqual({ email: 'ada@b.com' })
    })
  })
})
