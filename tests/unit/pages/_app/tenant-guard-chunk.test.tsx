import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { noteError } from '@/observability/errors'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { testUser } from '@/tests/mocks/handlers'

vi.mock('@/observability/errors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/observability/errors')>()),
  noteError: vi.fn(),
}))

/** The guard's chunk failing to load, as a deploy that removed it would. */
vi.mock('@/lib/tenant-guard', () => {
  throw new TypeError('Failed to fetch dynamically imported module: /assets/tenant-guard.js')
})

describe('the ?tenant guard’s chunk failing to load', () => {
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

  it('renders the page, leaves the URL as it is and notes the failed load', async () => {
    const router = createRouter({
      routeTree,
      context: { queryClient },
      history: createMemoryHistory({ initialEntries: ['/dashboard?tenant=acme'] }),
      ...ROUTER_DEFAULTS,
    })
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>
    )

    expect(await screen.findByRole('heading', { level: 1, name: /Welcome back/ })).toBeVisible()
    expect(router.state.location.href).toBe('/dashboard?tenant=acme')
    expect(noteError).toHaveBeenCalledWith(expect.any(Error), 'chunk_load', true)
  })
})
