import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { resetSessionForTests } from '@/http/session'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/** Mounts the real route tree on the security settings. */
function renderSecurity() {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ['/settings/account/security'] }),
    ...ROUTER_DEFAULTS,
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
}

describe('security settings page', () => {
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

  it('renders the Security section under the layout heading', async () => {
    renderSecurity()

    expect(await screen.findByRole('heading', { level: 1, name: 'Security' })).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Security' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Security' })).toHaveClass('sr-only')
    expect(
      await screen.findByRole('button', { name: 'Sign out other sessions' })
    ).toBeInTheDocument()
  })

  it('lists the account’s passkeys on the page', async () => {
    server.use(
      http.get('/api/v1/auth/passkeys', () =>
        ok(
          {
            passkeys: [
              {
                id: 'pk-1',
                name: 'MacBook',
                provider: { name: 'iCloud Keychain', iconLight: null, iconDark: null },
                synced: true,
                createdAt: '2026-10-01T10:00:00.000Z',
                lastUsedAt: null,
                credentialId: 'cred-1',
              },
            ],
            userHandle: 'H',
          },
          'Passkeys retrieved.'
        )
      )
    )
    renderSecurity()

    expect(await screen.findByText('MacBook')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Passkeys' })).toBeInTheDocument()
  })
})
