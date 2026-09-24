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

describe('reset-password page', () => {
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

  /**
   * The wire shape, asserted on the intercepted body rather than read off the
   * mutation: `confirmPassword` is a client-side concern and must not be
   * posted, and a refactor to `apiClient.post(url, input)` would send it
   * without any test noticing.
   */
  it('posts the token and password only — never confirmPassword', async () => {
    let body: unknown
    server.use(
      http.post('/api/v1/auth/reset-password', async ({ request }) => {
        body = await request.json()
        return ok(null, 'Password reset.')
      })
    )
    renderAt('/reset-password?token=tok-123')

    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('New password'), 'longenough8')
    await user.type(screen.getByLabelText('Confirm new password'), 'longenough8')
    await user.click(screen.getByRole('button', { name: 'Reset password' }))

    await waitFor(() => {
      expect(body).toEqual({ token: 'tok-123', password: 'longenough8' })
    })
    expect(body).not.toHaveProperty('confirmPassword')
  })

  it('refuses to submit when the two passwords differ', async () => {
    let called = false
    server.use(
      http.post('/api/v1/auth/reset-password', () => {
        called = true
        return ok(null, 'Password reset.')
      })
    )
    renderAt('/reset-password?token=tok-123')

    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('New password'), 'longenough8')
    await user.type(screen.getByLabelText('Confirm new password'), 'different99')
    await user.click(screen.getByRole('button', { name: 'Reset password' }))

    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument()
    expect(called).toBe(false)
  })

  it('says so when the link carries no token, instead of showing a form', async () => {
    renderAt('/reset-password')

    expect(await screen.findByText('This link is incomplete')).toBeInTheDocument()
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
  })
})
