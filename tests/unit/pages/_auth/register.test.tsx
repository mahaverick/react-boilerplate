import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const REGISTER_MESSAGE = 'If that address can be registered, a verification email has been sent.'

function renderRegisterAt(path: string): AnyRouter {
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

/** No refresh cookie, so `_auth`'s guard renders the page instead of bouncing to /dashboard. */
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

async function fillAndSubmit(email: string, password: string) {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Email'), email)
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Create account' }))
}

describe('register page', () => {
  beforeEach(arriveSignedOut)

  // The API answers 202 with `data: null` for every address, so the page must
  // not read a user off the response.
  it('shows "Check your email" with the address after a 202 carrying data: null', async () => {
    renderRegisterAt('/register')
    await fillAndSubmit('ada@b.com', 'secret123')

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument()
    expect(screen.getByText(/verification link to ada@b\.com\./)).toBeInTheDocument()
  })

  it('posts and shows the NORMALISED address, not what was typed', async () => {
    let body: unknown
    server.use(
      http.post('/api/v1/auth/register', async ({ request }) => {
        body = await request.json()
        return ok(null, REGISTER_MESSAGE, 202)
      })
    )
    renderRegisterAt('/register')
    await fillAndSubmit('  Ada@B.COM  ', 'secret123')

    expect(await screen.findByText(/verification link to ada@b\.com\./)).toBeInTheDocument()
    expect(screen.queryByText(/Ada@B\.COM/)).not.toBeInTheDocument()
    // Empty optional names are dropped by the schema, not posted as ''.
    expect(body).toEqual({ email: 'ada@b.com', password: 'secret123' })
  })

  it("maps the server's 400 field errors onto the form and stays on it", async () => {
    server.use(
      http.post('/api/v1/auth/register', () =>
        HttpResponse.json(
          {
            success: false,
            message: 'Validation failed',
            statusCode: 400,
            errors: { password: ['Password is too long.'] },
            requestId: 'test-request-id',
          },
          { status: 400 }
        )
      )
    )
    renderRegisterAt('/register')
    await fillAndSubmit('ada@b.com', 'secret123')

    expect(await screen.findByText('Password is too long.')).toBeInTheDocument()
    const password = screen.getByLabelText('Password')
    expect(password).toHaveAttribute('aria-invalid', 'true')
    expect(password).toHaveAccessibleDescription('Password is too long.')
    expect(screen.queryByRole('heading', { name: 'Check your email' })).not.toBeInTheDocument()
  })

  it('announces a rate-limited attempt and stays on the form', async () => {
    server.use(
      http.post('/api/v1/auth/register', () =>
        fail('Too many attempts. Please try again later.', 429, 'RATE_LIMITED')
      )
    )
    renderRegisterAt('/register')
    await fillAndSubmit('ada@b.com', 'secret123')

    expect(
      await screen.findByText('Too many attempts. Please try again later.')
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled()
    })
    expect(screen.getByRole('heading', { name: 'Create an account' })).toBeInTheDocument()
  })

  it('prefills the address from ?email=, and posts it', async () => {
    // How an invitation's "Create account" arrives.
    let body: unknown
    server.use(
      http.post('/api/v1/auth/register', async ({ request }) => {
        body = await request.json()
        return ok(null, REGISTER_MESSAGE, 202)
      })
    )
    renderRegisterAt('/register?email=ada%40b.com')

    expect(await screen.findByLabelText('Email')).toHaveValue('ada@b.com')
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Password'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => {
      expect(body).toEqual({ email: 'ada@b.com', password: 'secret123' })
    })
  })

  it('leaves the address empty without ?email=', async () => {
    renderRegisterAt('/register')

    expect(await screen.findByLabelText('Email')).toHaveValue('')
  })
})
