import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const LINKED_AT = '2026-01-01T00:00:00.000Z'

/**
 * Mounts the real Settings › Security route (`/settings/account/security`),
 * which renders the section, as a user reaches it.
 */
function renderSecurity() {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    ...ROUTER_DEFAULTS,
    history: createMemoryHistory({ initialEntries: ['/settings/account/security'] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return router
}

/** Serves the account's sign-in methods: these providers. */
function mockProviders(providers: string[]) {
  server.use(
    http.get('/api/v1/auth/providers', () =>
      ok(
        { providers: providers.map((provider) => ({ provider, linkedAt: LINKED_AT })) },
        'Auth providers retrieved.'
      )
    )
  )
}

/** The Security region, once the profile route has rendered it. */
async function section() {
  return within(await screen.findByRole('region', { name: 'Security' }))
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

  it('holds the sign-in methods’ place while they load', async () => {
    server.use(http.get('/api/v1/auth/providers', () => new Promise<Response>(() => {})))
    renderSecurity()
    const busy = await screen.findByRole('region', { name: 'Security' })
    expect(busy.querySelector('[data-slot="query-state"][aria-busy="true"]')).not.toBeNull()
    // One heading and two method rows.
    expect(busy.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Sign out other sessions' })).toBeVisible()
  })

  it('lists Email link with the masked address, and Google when linked', async () => {
    mockProviders(['email', 'google'])
    renderSecurity()

    const security = await section()
    const rows = await security.findAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual([`Email link (${testUser.email})`, 'Google'])
    expect(security.getByText(testUser.email)).toHaveClass('ph-sensitive', 'ph-mask')
    expect(security.getByRole('heading', { level: 2, name: 'Security' })).toHaveClass('sr-only')
    expect(security.queryByText('email')).not.toBeInTheDocument()
  })

  it('lists only Email link without Google', async () => {
    mockProviders(['email'])
    renderSecurity()

    const rows = await (await section()).findAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual([`Email link (${testUser.email})`])
  })

  it('shows an unrecognised provider by its own name', async () => {
    mockProviders(['email', 'github'])
    renderSecurity()

    expect(await (await section()).findByText('github')).toBeInTheDocument()
  })

  it('ignores a hasPassword field the API may still send', async () => {
    server.use(
      http.get('/api/v1/auth/providers', () =>
        ok(
          { providers: [{ provider: 'email', linkedAt: LINKED_AT }], hasPassword: true },
          'Auth providers retrieved.'
        )
      )
    )
    renderSecurity()

    const rows = await (await section()).findAllByRole('listitem')
    expect(rows).toHaveLength(1)
  })

  it('shows no password control or wording', async () => {
    mockProviders(['email', 'google'])
    renderSecurity()

    const security = await section()
    await security.findAllByRole('listitem')
    expect(screen.queryByText(/password/i)).toBeNull()
    expect(screen.queryByLabelText(/password/i)).toBeNull()
  })

  it('shows the load error for a failed providers read', async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/auth/providers', () => {
        calls += 1
        // Two failures: the query client retries once by itself.
        return calls <= 2
          ? fail('Something went wrong.', 500)
          : ok(
              { providers: [{ provider: 'email', linkedAt: LINKED_AT }] },
              'Auth providers retrieved.'
            )
      })
    )
    const user = userEvent.setup()
    renderSecurity()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'We couldn’t load your sign-in methods. Select Try again to load them.'
    )
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText(`Email link (`, { exact: false })).toBeInTheDocument()
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
    mockProviders(['email'])
    const requests = mockRevokeOthers(2)
    const user = userEvent.setup()
    renderSecurity()

    const security = await section()
    await user.click(await security.findByRole('button', { name: 'Sign out other sessions' }))

    expect(await screen.findByText('Signed out 2 other sessions.')).toBeInTheDocument()
    expect(requests).toHaveLength(1)
    expect(requests[0]?.body).toEqual({})
    expect(requests[0]?.contentType).toContain('application/json')
  })

  it('says one session in the singular, and none when there were none', async () => {
    mockProviders(['email'])
    mockRevokeOthers(1)
    const user = userEvent.setup()
    renderSecurity()

    const button = await (await section()).findByRole('button', { name: 'Sign out other sessions' })
    await user.click(button)
    expect(await screen.findByText('Signed out 1 other session.')).toBeInTheDocument()

    mockRevokeOthers(0)
    await user.click(button)
    expect(await screen.findByText('You have no other sessions.')).toBeInTheDocument()
  })

  it('is offered on a Google-only account too', async () => {
    mockProviders(['email', 'google'])
    renderSecurity()

    const button = await (
      await section()
    ).findByRole('button', {
      name: 'Sign out other sessions',
    })
    expect(button).toBeEnabled()
    expect(button).toHaveAccessibleDescription(
      'This ends every other browser and device session. You stay signed in here.'
    )
  })

  it('switches the button off while it signs out, so a second click sends nothing', async () => {
    mockProviders(['email'])
    let calls = 0
    /** Lets the held revoke request answer. */
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.post('/api/v1/auth/sessions/revoke-others', async () => {
        calls += 1
        await held
        return ok({ revoked: 1 }, 'Other sessions signed out.')
      })
    )
    const user = userEvent.setup()
    renderSecurity()

    const security = await section()
    await user.click(await security.findByRole('button', { name: 'Sign out other sessions' }))
    const pending = await security.findByRole('button', { name: 'Signing out…' })
    expect(pending).toBeDisabled()
    await user.click(pending)
    release()

    expect(await screen.findByText('Signed out 1 other session.')).toBeInTheDocument()
    expect(calls).toBe(1)
  })

  it('shows the server’s message when it is refused', async () => {
    mockProviders(['email'])
    server.use(
      http.post('/api/v1/auth/sessions/revoke-others', () =>
        fail('Too many attempts. Try again in 15 minutes.', 429, 'RATE_LIMITED')
      )
    )
    const user = userEvent.setup()
    renderSecurity()

    await user.click(
      await (await section()).findByRole('button', { name: 'Sign out other sessions' })
    )
    expect(
      await screen.findByText('Too many attempts. Try again in 15 minutes.')
    ).toBeInTheDocument()
  })
})
