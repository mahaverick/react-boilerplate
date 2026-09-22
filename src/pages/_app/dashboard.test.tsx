import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { testUser } from '@/tests/mocks/handlers'

function renderDashboard() {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ['/dashboard'] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
}

describe('dashboard page', () => {
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

  it('greets the signed-in user under a level-one heading', async () => {
    renderDashboard()

    const heading = await screen.findByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent('Welcome back, A')
  })

  it('falls back to the email when the profile carries no first name', async () => {
    useAuthStore.setState({ user: { ...testUser, firstName: null } })
    renderDashboard()

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      `Welcome back, ${testUser.email}`
    )
  })

  it('names no tenant: scope lives in the URL, not in a dashboard widget', async () => {
    renderDashboard()
    await screen.findByRole('heading', { level: 1 })

    expect(screen.queryByText(/tenant/i)).not.toBeInTheDocument()
  })
})
