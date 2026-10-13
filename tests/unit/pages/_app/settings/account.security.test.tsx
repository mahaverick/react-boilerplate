import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { testUser } from '@/tests/mocks/handlers'

/** Mounts the real route tree on the security settings. */
function renderSecurity() {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ['/settings/account/security'] }),
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
    expect(await screen.findByRole('button', { name: 'Change password' })).toBeInTheDocument()
  })
})
