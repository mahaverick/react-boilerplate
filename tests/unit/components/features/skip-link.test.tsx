import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { fail, testUser } from '@/tests/mocks/handlers'
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
}

/** Tab once from the top of the page, then activate whatever took focus. */
async function tabToSkipLinkAndActivate() {
  const user = userEvent.setup()
  await user.tab()
  expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Skip to content' }))
  await user.keyboard('{Enter}')
}

describe('skip link', () => {
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
  })

  it('is the first Tab stop on an app page and moves focus to the main landmark', async () => {
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })

    await tabToSkipLinkAndActivate()

    const main = screen.getByRole('main')
    expect(main).toHaveAttribute('id', 'main')
    expect(document.activeElement).toBe(main)
  })

  it('does the same on the sign-in page', async () => {
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
    server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
    renderAppAt('/login')
    await screen.findByRole('heading', { name: 'Sign in', level: 1 })

    await tabToSkipLinkAndActivate()

    const main = screen.getByRole('main')
    expect(main).toHaveAttribute('id', 'main')
    expect(document.activeElement).toBe(main)
  })
})
