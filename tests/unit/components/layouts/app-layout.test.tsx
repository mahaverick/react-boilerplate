import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { useSidebarStore } from '@/states/sidebar.store'
import { useThemeStore } from '@/states/theme.store'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { fail, ok, tenantDetail, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/** One tenant row, for the dynamic-route breadcrumb case below. */
const ACME = {
  id: TENANT_ID,
  name: 'Acme Corp',
  slug: 'acme',
  description: null,
  logo: null,
  website: null,
  lifecycleState: 'active',
  deletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const LOGOUT_FAILED = "Couldn't sign out. Check your connection and try again."

/** Every way POST /auth/logout can fail without the server saying the session is over. */
const LOGOUT_FAILURES: [string, () => Response][] = [
  ['the API cannot be reached', () => HttpResponse.error()],
  ['a 503 from a restarting upstream', () => fail('Service Unavailable', 503)],
  [
    'a 429 from the logout rate limiter',
    () => fail('Too many attempts. Please try again later.', 429, 'RATE_LIMITED'),
  ],
]

/**
 * Mounts the real route tree at `path`: the layout reads `useMatches()` for its breadcrumbs
 * and renders `<Link>` nav items, neither of which works outside a router. The returned
 * router also carries `unmount`.
 */
function renderAppAt(path: string): AnyRouter & { unmount: () => void } {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const { unmount } = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return Object.assign(router as AnyRouter, { unmount })
}

describe('AppLayout', () => {
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    useSidebarStore.setState({ isCollapsed: false })
    // Bootstrapped, so __root's beforeLoad returns at once and _app's guard lets the layout render.
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

    // SidebarInset is already a <main>; a second one around the Outlet would fail axe's `landmark-no-duplicate-main`.
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
    renderAppAt('/settings/account/profile')
    const breadcrumb = await screen.findByRole('navigation', { name: 'breadcrumb' })

    expect(within(breadcrumb).getByText('Profile')).toBeInTheDocument()
    // `_app` is pathless and contributes no crumb.
    expect(within(breadcrumb).queryByText('Dashboard')).not.toBeInTheDocument()
  })

  /**
   * `Tenants` is added by the breadcrumb builder, because no match produces it (the list
   * route is a sibling of the detail route); `acme` comes from the dynamic route's crumb
   * function and `Overview` from the leaf.
   */
  it('shows a breadcrumb trail on a DYNAMIC route', async () => {
    server.use(
      http.get('/api/v1/tenants', () =>
        ok([{ tenant: ACME, role: 'viewer' }], 'Tenants retrieved.')
      ),
      http.get('/api/v1/tenants/acme', () => ok(tenantDetail(ACME, 'viewer'), 'Tenant retrieved.'))
    )
    renderAppAt('/tenants/acme')
    const breadcrumb = await screen.findByRole('navigation', { name: 'breadcrumb' })

    const trail = within(breadcrumb)
      .getAllByRole('listitem')
      .map((item) => item.textContent?.trim())
      .filter((text) => text !== '')
    expect(trail).toEqual(['Tenants', 'acme', 'Overview'])

    expect(within(breadcrumb).getByRole('link', { name: 'Tenants' })).toHaveAttribute(
      'href',
      '/tenants'
    )
  })

  it('shows a breadcrumb trail on a DYNAMIC settings route, under Settings', async () => {
    server.use(
      http.get('/api/v1/tenants', () =>
        ok([{ tenant: ACME, role: 'viewer' }], 'Tenants retrieved.')
      ),
      http.get('/api/v1/tenants/acme', () => ok(tenantDetail(ACME, 'viewer'), 'Tenant retrieved.')),
      http.get('/api/v1/tenants/acme/members', () => ok([], 'Members retrieved.'))
    )
    renderAppAt('/settings/workspace/acme/members')
    const breadcrumb = await screen.findByRole('navigation', { name: 'breadcrumb' })

    await waitFor(() => {
      const trail = within(breadcrumb)
        .getAllByRole('listitem')
        .map((item) => item.textContent?.trim())
        .filter((text) => text !== '')
      expect(trail).toEqual(['Settings', 'acme', 'Members'])
    })
    expect(within(breadcrumb).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/settings'
    )
  })

  it('does not put a Tenants crumb in front of the tenants list itself', async () => {
    renderAppAt('/tenants')
    const breadcrumb = await screen.findByRole('navigation', { name: 'breadcrumb' })

    const trail = within(breadcrumb)
      .getAllByRole('listitem')
      .map((item) => item.textContent?.trim())
      .filter((text) => text !== '')
    expect(trail).toEqual(['Tenants'])
  })

  /**
   * The header's content sits inside `TenantSwitcher`'s `<nav aria-label="Tenant">`
   * landmark, which is why axe's `region` rule passes over it. On top of that, every text
   * node must be inside a button or a link, so no bare text sits beside the widget it
   * belongs to. It walks text nodes, not elements, because an ancestor `ul` would "contain"
   * text that belongs to a button several levels down.
   */
  it('keeps every piece of sidebar-header content inside a widget', async () => {
    renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })

    const header = document.querySelector('[data-slot="sidebar-header"]')
    expect(header).not.toBeNull()
    const walker = document.createTreeWalker(header as Node, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue
      expect(node.parentElement?.closest('button,a')).not.toBeNull()
    }
    expect(screen.getByRole('combobox', { name: /Switch tenant/ })).toBeInTheDocument()
  })

  it('navigates to the profile from the account menu', async () => {
    const user = userEvent.setup()
    const router = renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })

    await user.click(screen.getByRole('button', { name: 'Account menu for A B' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Profile' }))

    // The route must change, which a handler that only closes the menu would not do.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/settings/account/profile')
    })
  })

  /**
   * `window.location.assign` is non-configurable in jsdom, so `vi.spyOn` on it throws
   * "Cannot redefine property"; the whole `location` object is replaced and `afterEach`
   * puts the real one back.
   */
  it('signs out from the account menu', async () => {
    server.use(http.post('/api/v1/auth/logout', () => ok(null, 'Signed out.')))
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

  /** Replaces `window.location` with a copy whose `assign` is a spy, which it returns; jsdom's own cannot be spied on. */
  function stubAssign() {
    const assign = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign },
    })
    return assign
  }

  /** Signs out through the app layout's account menu, as a user does. */
  async function clickSignOut() {
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Account menu for A B' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
  }

  // The server never revoked the session, so clearing it here would leave a live refresh cookie behind a UI that says the user signed out.
  it.each(LOGOUT_FAILURES)(
    'keeps the session and says so when sign-out fails on %s',
    async (_label, respond) => {
      server.use(http.post('/api/v1/auth/logout', () => respond()))
      const assign = stubAssign()
      renderAppAt('/dashboard')
      await screen.findByRole('heading', { name: /Welcome back/ })

      await clickSignOut()

      expect(await screen.findByText(LOGOUT_FAILED)).toBeInTheDocument()
      expect(useAuthStore.getState().isAuthenticated).toBe(true)
      expect(assign).not.toHaveBeenCalled()
    }
  )

  // A 401 means the server already considers the session over.
  it('signs out when the logout itself answers 401, redirecting exactly once', async () => {
    server.use(http.post('/api/v1/auth/logout', () => fail('Unauthorized', 401)))
    const assign = stubAssign()
    renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })

    await clickSignOut()

    await waitFor(() => {
      expect(useAuthStore.getState().isAuthenticated).toBe(false)
    })
    expect(assign).toHaveBeenCalledWith('/login')
    // skipAuthRetry keeps the interceptor's own 401 verdict from redirecting first.
    expect(assign).toHaveBeenCalledTimes(1)
  })

  it('tells other tabs when signing out succeeds', async () => {
    server.use(http.post('/api/v1/auth/logout', () => ok(undefined, 'Logged out.')))
    stubAssign()
    const otherTab = new BroadcastChannel('auth')
    const received: unknown[] = []
    otherTab.addEventListener('message', (event: MessageEvent<unknown>) => {
      received.push(event.data)
    })
    try {
      renderAppAt('/dashboard')
      await screen.findByRole('heading', { name: /Welcome back/ })

      await clickSignOut()

      await vi.waitFor(() => expect(received).toEqual([{ type: 'logout' }]))
    } finally {
      otherTab.close()
    }
  })

  it('takes its open state from the sidebar store', async () => {
    useSidebarStore.setState({ isCollapsed: true })
    renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })

    // The provider is controlled by the store, so the sidebar is collapsed on first paint, not after a click.
    expect(document.querySelector('[data-state="collapsed"]')).not.toBeNull()
  })

  it('offers staff a Platform item that opens the platform tenant', async () => {
    useAuthStore.setState({ user: { ...testUser, platformRole: 'viewer' } })
    const user = userEvent.setup()
    renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })

    await user.click(screen.getByRole('button', { name: 'Account menu for A B' }))

    expect(await screen.findByRole('menuitem', { name: 'Platform' })).toHaveAttribute(
      'href',
      '/tenants/platform'
    )
  })

  it('offers no Platform item to someone who is not staff', async () => {
    const user = userEvent.setup()
    renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })

    await user.click(screen.getByRole('button', { name: 'Account menu for A B' }))

    await screen.findByRole('menuitem', { name: 'Profile' })
    expect(screen.queryByRole('menuitem', { name: 'Platform' })).not.toBeInTheDocument()
  })

  it.each(['viewer', 'admin', 'owner'] as const)(
    'offers staff the Platform item and no Platform activity, at any role (%s)',
    async (platformRole) => {
      useAuthStore.setState({ user: { ...testUser, platformRole } })
      const user = userEvent.setup()
      renderAppAt('/dashboard')
      await screen.findByRole('heading', { name: /Welcome back/ })

      await user.click(screen.getByRole('button', { name: 'Account menu for A B' }))

      await screen.findByRole('menuitem', { name: 'Platform' })
      expect(screen.queryByRole('menuitem', { name: 'Platform activity' })).not.toBeInTheDocument()
    }
  )
})

/**
 * `theme: 'system'` following a live OS change. The listener sits in AppLayout, not in
 * ThemeToggle: under `md` the sidebar renders into a Sheet (a Base UI Dialog.Popup with no
 * `keepMounted`), so ThemeToggle does not exist while the drawer is closed and an effect
 * inside it would work on desktop only.
 */
describe('AppLayout system theme', () => {
  const DARK_QUERY = '(prefers-color-scheme: dark)'
  const realInnerWidth = window.innerWidth

  let darkListeners = new Set<(event: MediaQueryListEvent) => void>()
  let prefersDark = false
  let originalMatchMedia: typeof window.matchMedia

  /**
   * A `matchMedia` stub whose listeners fire, unlike the one in `tests/setup.ts`. It also
   * answers the `(max-width: …)` query `useIsMobile` asks, so setting `innerWidth` picks a viewport.
   */
  function installMatchMedia() {
    window.matchMedia = ((query: string) => ({
      get matches() {
        if (query === DARK_QUERY) return prefersDark
        const maxWidth = /max-width:\s*(\d+)px/.exec(query)
        return maxWidth ? window.innerWidth <= Number(maxWidth[1]) : false
      },
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        if (query === DARK_QUERY) darkListeners.add(listener)
      },
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        darkListeners.delete(listener)
      },
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }

  /** The OS colour scheme changes while the tab is open. */
  function osSwitchesTo(dark: boolean) {
    prefersDark = dark
    act(() => {
      for (const listener of darkListeners) listener({ matches: dark } as MediaQueryListEvent)
    })
  }

  /** Picks the viewport width the `matchMedia` stub reports; `afterEach` restores the real one. */
  function setViewportWidth(width: number) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  }

  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    useSidebarStore.setState({ isCollapsed: false })
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    useThemeStore.setState({ theme: 'system' })
    darkListeners = new Set()
    prefersDark = false
    // Bound because `@typescript-eslint/unbound-method` rejects lifting a method off its object, and the copy is only used to restore it.
    originalMatchMedia = window.matchMedia.bind(window)
    installMatchMedia()
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
    setViewportWidth(realInnerWidth)
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    useThemeStore.setState({ theme: 'system' })
  })

  it('follows a live OS change on a desktop viewport', async () => {
    setViewportWidth(1280)
    renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    osSwitchesTo(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    osSwitchesTo(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('follows a live OS change on a phone, where the sidebar is unmounted', async () => {
    setViewportWidth(500)
    renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })

    // The premise: below `md` the closed drawer leaves no sidebar content in the document, so a listener in the sidebar would be dead here.
    expect(screen.queryByRole('button', { name: /^Account menu for/ })).not.toBeInTheDocument()

    osSwitchesTo(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('ignores an OS change once the user has chosen a theme explicitly', async () => {
    useThemeStore.setState({ theme: 'light' })
    renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })

    osSwitchesTo(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('stops listening once the layout unmounts', async () => {
    const { unmount } = renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })
    osSwitchesTo(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    unmount()
    document.documentElement.classList.remove('dark')
    // Asserted by behaviour, not by counting listeners: sonner's <Toaster> registers on the same query, so the count is never just ours.
    osSwitchesTo(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
