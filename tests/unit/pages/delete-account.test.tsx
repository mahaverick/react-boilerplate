import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { APP_NAME } from '@/constants/app'
import { resetSessionForTests } from '@/http/session'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/** Mounts the real route tree on the public page and returns the router. */
function renderDeleteAccount() {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ['/delete-account'] }),
    ...ROUTER_DEFAULTS,
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return router
}

describe('/delete-account', () => {
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
  })

  it('a signed-in visitor at /delete-account lands on the settings page', async () => {
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    const router = renderDeleteAccount()

    expect(await screen.findByRole('heading', { level: 1, name: 'Delete account' })).toBeVisible()
    expect(router.state.location.pathname).toBe('/settings/account/delete')
    expect(
      screen.queryByRole('button', { name: 'Email me a sign-in link' })
    ).not.toBeInTheDocument()
  })

  it('a signed-out visitor sees the app name, the steps and what we delete', async () => {
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: true,
    })
    renderDeleteAccount()

    expect(
      await screen.findByRole('heading', { level: 1, name: `Delete your ${APP_NAME} account` })
    ).toBeVisible()
    expect(screen.getByRole('list')).toHaveTextContent(
      'Select Request deletion. We may ask you to confirm it’s you.'
    )
    expect(screen.getByRole('heading', { level: 2, name: 'What we delete' })).toBeVisible()
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  it('a signed-out visitor at /delete-account requests a sign-in link that returns to the settings page', async () => {
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: true,
    })
    const bodies: unknown[] = []
    server.use(
      http.post('/api/v1/auth/link/request', async ({ request }) => {
        bodies.push(await request.json())
        return ok(null, 'Check your inbox for a sign-in link.', 202)
      })
    )
    const user = userEvent.setup()
    renderDeleteAccount()

    await user.type(await screen.findByLabelText('Email'), 'Ada@Example.com')
    await user.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Check your inbox' })).toBeVisible()
    expect(bodies).toEqual([
      expect.objectContaining({ email: 'ada@example.com', redirect: '/settings/account/delete' }),
    ])
  })
})
