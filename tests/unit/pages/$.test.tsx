import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { fail } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

function renderAppAt(path: string) {
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

  // Nothing upstream matched, so no `_app`/`_auth` layout rendered a `<main>` for it: this route supplies its own.
  it('renders exactly one main landmark for an unknown URL', async () => {
    renderAppAt('/definitely-not-a-page')

    await screen.findByRole('heading', { level: 1, name: 'Page not found' })
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })
})
