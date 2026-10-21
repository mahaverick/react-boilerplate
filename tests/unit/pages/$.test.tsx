import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { resetSessionForTests } from '@/http/session'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { fail } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/** Renders the real route tree at `path`, as a visitor reaches it. */
function renderAppAt(path: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
    ...ROUTER_DEFAULTS,
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return router
}

describe('the catch-all route', () => {
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

  // Nothing matched, so no `_app` or `_auth` layout supplies a `<main>`: this route brings its own.
  it('renders exactly one main landmark for an unknown URL', async () => {
    renderAppAt('/definitely-not-a-page')

    await screen.findByRole('heading', { level: 1, name: 'Page not found' })
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByText('Check the address, or go home.')).toBeInTheDocument()
  })
})
