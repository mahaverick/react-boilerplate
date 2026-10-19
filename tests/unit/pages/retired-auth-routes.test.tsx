import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
  type RouterHistory,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { fail } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/** Mounts the real route tree at `path` and returns the router. */
function renderAt(path: string): AnyRouter {
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
  return router as AnyRouter
}

/**
 * The old password paths, still reached from mailed links and bookmarks. Run
 * signed out: a signed-in visitor goes on from /login to the dashboard, which
 * `guards.test.tsx` covers.
 */
describe('retired password paths', () => {
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

  it.each([
    '/register?email=a%40b.test',
    '/forgot-password',
    '/reset-password?token=ttt',
    '/verify-email?token=ttt',
  ])('redirects %s to /login with the note and no token', async (path) => {
    const router = renderAt(path)

    await waitFor(() => {
      expect(router.state.location.href).toBe('/login?notice=sign-in-link')
    })
    expect(await screen.findByText('Sign-in now uses email links.')).toBeInTheDocument()
    expect(router.state.location.href).not.toContain('ttt')
    expect(router.state.location.href).not.toContain('email')
    // replace: Back does not return to the dead path.
    expect((router.history as RouterHistory).length).toBe(1)
  })
})
