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

/**
 * A visitor with no refresh cookie, so `_auth`'s guard lets the login page
 * render instead of bouncing them to /dashboard.
 */
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

describe('login page', () => {
  beforeEach(arriveSignedOut)

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

  it('posts the NORMALISED email, not what was typed', async () => {
    let body: unknown
    server.use(
      http.post('/api/v1/auth/login', async ({ request }) => {
        body = await request.json()
        return signedInResponse()
      })
    )
    renderLoginAt('/login')
    await fillAndSubmit('  ADA@B.COM  ', 'secret123')

    // The schema trims and lower-cases, but TanStack hands `onSubmit` the raw
    // form state — only parsing the value before posting puts the transform on
    // the wire. Without that this arrives as "  ADA@B.COM  ".
    await waitFor(() => {
      expect(body).toEqual({ email: 'ada@b.com', password: 'secret123' })
    })
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

/**
 * Spec section 9: inline errors under each field, mapped from the envelope's
 * `errors`. The clearing rule is the interesting half — a server verdict is
 * stale the moment the user starts fixing THAT field, and no sooner, and only
 * for that field.
 */
describe('server-side validation errors', () => {
  /**
   * The exact envelope the backend emits: `{...fieldErrors,
   * ...(formErrors.length > 0 && { formErrors })}`. `formErrors` is the one
   * key that is not a field name.
   */
  function validationFailure() {
    return HttpResponse.json(
      {
        success: false,
        message: 'Validation failed.',
        statusCode: 400,
        errors: {
          email: ['That address is not registered.'],
          password: ['Password is too short.'],
          formErrors: ['These credentials are not valid together.'],
        },
        requestId: 'test-request-id',
      },
      { status: 400 }
    )
  }

  beforeEach(() => {
    arriveSignedOut()
    server.use(http.post('/api/v1/auth/login', () => validationFailure()))
  })

  it('renders a field error under its own field and describes the control', async () => {
    renderLoginAt('/login')
    await fillAndSubmit('a@b.com', 'secret123')

    expect(await screen.findByText('That address is not registered.')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(
      'That address is not registered.'
    )
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('Password is too short.')
  })

  it('clears a field error when that field changes — and leaves its sibling alone', async () => {
    renderLoginAt('/login')
    await fillAndSubmit('a@b.com', 'secret123')
    expect(await screen.findByText('That address is not registered.')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Email'), 'x')

    await waitFor(() => {
      expect(screen.queryByText('That address is not registered.')).not.toBeInTheDocument()
    })
    // The load-bearing half: the user has not touched the password, so what
    // the server said about it is still true and must still be on screen.
    expect(screen.getByText('Password is too short.')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('Password is too short.')
  })

  it('does not clear on blur alone', async () => {
    renderLoginAt('/login')
    await fillAndSubmit('a@b.com', 'secret123')
    expect(await screen.findByText('That address is not registered.')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Email'))
    await user.click(screen.getByLabelText('Password'))

    expect(screen.getByText('That address is not registered.')).toBeInTheDocument()
  })

  it('renders formErrors at form level, against no input', async () => {
    renderLoginAt('/login')
    await fillAndSubmit('a@b.com', 'secret123')

    const message = await screen.findByText('These credentials are not valid together.')
    expect(message.closest('[role="alert"]')).not.toBeNull()
    // It names no field, so it must not be wired to one — an input called
    // "formErrors" does not exist.
    expect(screen.getByLabelText('Email')).not.toHaveAccessibleDescription(
      'These credentials are not valid together.'
    )
    expect(screen.getByLabelText('Password')).not.toHaveAccessibleDescription(
      'These credentials are not valid together.'
    )
  })

  it('drops the previous verdict when the form is submitted again', async () => {
    renderLoginAt('/login')
    await fillAndSubmit('a@b.com', 'secret123')
    expect(await screen.findByText('Password is too short.')).toBeInTheDocument()

    server.use(http.post('/api/v1/auth/login', () => signedInResponse()))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(screen.queryByText('Password is too short.')).not.toBeInTheDocument()
    })
  })
})

describe('safeRedirect', () => {
  it('accepts an absolute same-origin path', () => {
    expect(safeRedirect('/dashboard')).toBe('/dashboard')
    expect(safeRedirect('/tenants/acme?tab=members')).toBe('/tenants/acme?tab=members')
  })

  it('keeps the query and hash, which a redirect target may carry', () => {
    expect(safeRedirect('/dashboard?next=1')).toBe('/dashboard?next=1')
    expect(safeRedirect('/dashboard#section')).toBe('/dashboard#section')
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

  /**
   * Every one of these starts with exactly one slash, so a
   * `^/(?![/\\])`-shaped test passes them — and the URL standard still
   * resolves them off-origin. The first four because the parser STRIPS ASCII
   * tab, LF and CR, leaving "//"; the last three because dot segments collapse
   * to "//". All are typeable into the URL bar as %09, %0A, %0D and ..%2F%2F.
   *
   * Nothing escapes through TanStack today, which normalises them before
   * pushState — but that is the router's behaviour, not this guard's, and
   * `useLogout` already reaches for `window.location.assign`, which normalises
   * nothing.
   */
  it.each([
    ['tab', '/\t/evil.example'],
    ['line feed', '/\n/evil.example'],
    ['carriage return', '/\r/evil.example'],
    ['tab then backslash', '/\t\\evil.example'],
    ['double dot segment', '/..//evil.example'],
    ['single dot segment', '/.//evil.example'],
    ['dot segments below the root', '/a/../..//evil.example'],
  ])('rejects the %s bypass', (_label, input) => {
    expect(safeRedirect(input)).toBeNull()
  })
})
