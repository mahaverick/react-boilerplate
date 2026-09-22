import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { useSidebarStore } from '@/states/sidebar.store'
import { ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/**
 * Driven through a real RouterProvider: the layout reads `useMatches()` for
 * its breadcrumbs and renders `<Link>` nav items, neither of which exists
 * outside a router.
 */
function renderAppAt(path: string): AnyRouter {
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

describe('AppLayout', () => {
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    useSidebarStore.setState({ isCollapsed: false })
    // Already bootstrapped, so __root's beforeLoad returns immediately and
    // _app's guard lets the layout render.
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
  })

  const realLocation = window.location

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
  })

  it('renders exactly one main landmark', async () => {
    renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })

    // SidebarInset already IS a <main>. A second <main> around the Outlet
    // would be an axe `landmark-no-duplicate-main` failure.
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  it('renders nav items as real anchors', async () => {
    renderAppAt('/dashboard')
    const nav = await screen.findByRole('navigation', { name: 'Main' })

    const link = within(nav).getByRole('link', { name: 'Dashboard' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/dashboard')
  })

  it('gives every icon-only control its own accessible name', async () => {
    renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })

    expect(screen.getByRole('button', { name: 'Toggle sidebar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Account menu for A B' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Theme: system. Change theme' })).toBeInTheDocument()
  })

  it('shows a breadcrumb for the current route', async () => {
    renderAppAt('/profile')
    const breadcrumb = await screen.findByRole('navigation', { name: 'breadcrumb' })

    expect(within(breadcrumb).getByText('Profile')).toBeInTheDocument()
    // The layout route itself contributes no crumb: `_app` is pathless.
    expect(within(breadcrumb).queryByText('Dashboard')).not.toBeInTheDocument()
  })

  it('navigates to the profile from the account menu', async () => {
    const user = userEvent.setup()
    const router = renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })

    await user.click(screen.getByRole('button', { name: 'Account menu for A B' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Profile' }))

    // A real router navigation, not a click handler that only closes the menu.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/profile')
    })
  })

  it('signs out from the account menu', async () => {
    server.use(http.post('/api/v1/auth/logout', () => ok(null, 'Signed out.')))
    // `window.location.assign` is non-configurable in jsdom, so vi.spyOn on it
    // throws "Cannot redefine property". Replacing the whole `location` object
    // is the way in; `afterEach` puts the real one back.
    const assign = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign },
    })
    const user = userEvent.setup()
    renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })

    await user.click(screen.getByRole('button', { name: 'Account menu for A B' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }))

    await waitFor(() => {
      expect(useAuthStore.getState().isAuthenticated).toBe(false)
    })
    expect(assign).toHaveBeenCalledWith('/login')
  })

  it('takes its open state from the sidebar store', async () => {
    useSidebarStore.setState({ isCollapsed: true })
    renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })

    // The provider is controlled by the store, so a collapsed store means a
    // collapsed sidebar on first paint rather than after a click.
    expect(document.querySelector('[data-state="collapsed"]')).not.toBeNull()
  })
})
