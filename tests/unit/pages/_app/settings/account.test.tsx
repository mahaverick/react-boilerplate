import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { testUser } from '@/tests/mocks/handlers'

/** Mounts the real route tree at `path`. */
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

describe('account settings', () => {
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

  it.each(['/profile', '/profile/'])('redirects %s to the profile settings', async (path) => {
    const router = renderAt(path)
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/account/profile'))
  })

  it.each([
    ['/settings/account/profile', 'Profile'],
    ['/settings/account/security', 'Security'],
    ['/settings/account/notifications', 'Notifications'],
  ])('titles %s after its section', async (path, name) => {
    renderAt(path)
    expect(await screen.findByRole('heading', { level: 1, name })).toBeInTheDocument()
  })
})
