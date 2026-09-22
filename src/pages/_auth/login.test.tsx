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
import { safeRedirect } from '@/pages/_auth/login'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/**
 * Driven through a real RouterProvider rather than by rendering the component
 * alone. The page reads `Route.useSearch()` and calls `useNavigate()`, neither
 * of which exists outside a router — and the only way to render it standalone
 * would be to export the component from the route file. `?redirect=` handling
 * is the heart of this page, so the router is the subject, not scaffolding.
 */
function renderLoginAt(path: string): AnyRouter {
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

function signedInResponse() {
  return ok({ accessToken: 'access-token', user: testUser }, 'Signed in.')
}

async function fillAndSubmit(email: string, password: string) {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Email'), email)
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('login page', () => {
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
    // No refresh cookie: the visitor is signed out, so `_auth`'s guard lets
    // the login page render instead of bouncing them to /dashboard.
    server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
  })

  it('reports both fields when submitted empty', async () => {
    renderLoginAt('/login')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument()
    expect(screen.getByText('Password is required.')).toBeInTheDocument()
  })

  it('rejects a malformed email and wires the error to the input', async () => {
    renderLoginAt('/login')
    await fillAndSubmit('nope', 'secret123')

    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument()
    // Spec section 9: the control itself must say it is invalid and point at
    // the message, not merely have a message rendered somewhere near it.
    const email = screen.getByLabelText('Email')
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveAccessibleDescription('Enter a valid email address.')
  })

  it('posts once on a valid submit and moves to the dashboard', async () => {
    let calls = 0
    server.use(
      http.post('/api/v1/auth/login', () => {
        calls += 1
        return signedInResponse()
      })
    )
    const router = renderLoginAt('/login')
    await fillAndSubmit('a@b.com', 'secret123')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/dashboard')
    })
    expect(calls).toBe(1)
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it("surfaces the server's own message on a 401", async () => {
    server.use(http.post('/api/v1/auth/login', () => fail('Invalid email or password.', 401)))
    const router = renderLoginAt('/login')
    await fillAndSubmit('a@b.com', 'wrong-password')

    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('honours a same-origin ?redirect= after signing in', async () => {
    server.use(http.post('/api/v1/auth/login', () => signedInResponse()))
    const router = renderLoginAt('/login?redirect=%2Fdashboard%3Fnext%3D1')
    await fillAndSubmit('a@b.com', 'secret123')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/dashboard')
    })
    // The discriminating part: `next=1` can only have come from the redirect
    // param, since the fallback target carries no search at all.
    expect(router.state.location.searchStr).toContain('next=1')
  })

  it('ignores an off-site ?redirect= and falls back to the dashboard', async () => {
    server.use(http.post('/api/v1/auth/login', () => signedInResponse()))
    const router = renderLoginAt('/login?redirect=https%3A%2F%2Fevil.example%2Fsteal')
    await fillAndSubmit('a@b.com', 'secret123')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/dashboard')
    })
    expect(router.state.location.href).not.toContain('evil.example')
  })

  it('ignores a protocol-relative ?redirect=', async () => {
    server.use(http.post('/api/v1/auth/login', () => signedInResponse()))
    const router = renderLoginAt('/login?redirect=%2F%2Fevil.example%2Fsteal')
    await fillAndSubmit('a@b.com', 'secret123')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/dashboard')
    })
    expect(router.state.location.href).not.toContain('evil.example')
  })
})

describe('safeRedirect', () => {
  it('accepts an absolute same-origin path', () => {
    expect(safeRedirect('/dashboard')).toBe('/dashboard')
    expect(safeRedirect('/tenants/acme?tab=members')).toBe('/tenants/acme?tab=members')
  })

  it('rejects everything that could leave the origin', () => {
    // `?redirect=` comes off the URL bar, so every one of these is reachable.
    expect(safeRedirect('https://evil.example')).toBeNull()
    expect(safeRedirect('//evil.example')).toBeNull()
    // Browsers normalise a backslash here to a slash, making it
    // protocol-relative.
    expect(safeRedirect('/\\evil.example')).toBeNull()
    expect(safeRedirect('javascript:alert(1)')).toBeNull()
    expect(safeRedirect('dashboard')).toBeNull()
    expect(safeRedirect(undefined)).toBeNull()
    expect(safeRedirect('')).toBeNull()
  })
})
