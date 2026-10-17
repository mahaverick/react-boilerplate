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
import { prefetchPalette } from '@/components/shared/command-palette/palette-loader'
import { recordRecent } from '@/components/shared/command-palette/recent-items'
import { resetSessionForTests } from '@/http/session'
import * as shortcut from '@/lib/shortcut'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { useCommandPaletteStore } from '@/states/command-palette.store'
import { useThemeStore } from '@/states/theme.store'
import { PLATFORM_TENANT_ID, TENANT_ID, TENANT_ID_2, TENANT_ID_9 } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { ok, tenantDetail, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/** A tenant row as `GET /tenants` carries it. */
function tenantRow(id: string, name: string, slug: string, lifecycleState = 'active') {
  return {
    id,
    name,
    slug,
    description: null,
    logo: null,
    website: null,
    lifecycleState,
    isPlatform: false,
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

vi.mock('@/components/shared/command-palette/palette-loader', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/components/shared/command-palette/palette-loader')>()
  return { ...original, prefetchPalette: vi.fn(original.prefetchPalette) }
})

const ACME = tenantRow(TENANT_ID, 'Acme Corp', 'acme')
const BETA = tenantRow(TENANT_ID_2, 'Beta Inc', 'beta')
const GAMMA = tenantRow(TENANT_ID_9, 'Gamma Ltd', 'gamma', 'suspended')
const PLATFORM = { ...tenantRow(PLATFORM_TENANT_ID, 'Platform', 'platform'), isPlatform: true }

/** `GET /tenants` answering the given tenants, each as an owner's membership. */
function serveTenants(...tenants: (typeof ACME)[]) {
  server.use(
    http.get('/api/v1/tenants', () =>
      ok(
        listPage(
          tenants.map((tenant) => ({
            tenant,
            role: 'owner',
            isPlatform: tenant.isPlatform,
            joinedAt: '2026-01-01T00:00:00.000Z',
          }))
        ),
        'Tenants.'
      )
    ),
    http.get('/api/v1/tenants/:slug', ({ params }) => {
      const tenant = tenants.find((row) => row.slug === params.slug) ?? ACME
      return ok(tenantDetail(tenant, 'owner'), 'Tenant.')
    })
  )
}

/** Mounts the real route tree at `path` and returns the router. */
function renderShell(path: string): AnyRouter {
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

/** Opens the palette from the header's Search… button. */
async function openPalette(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /Search…/ }))
  return screen.findByRole('dialog', { name: 'Command palette' })
}

describe('CommandPalette', () => {
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    localStorage.clear()
    useCommandPaletteStore.setState({ open: false, query: '' })
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    serveTenants(ACME, BETA, GAMMA, PLATFORM)
  })

  afterEach(() => {
    useCommandPaletteStore.setState({ open: false, query: '' })
    vi.restoreAllMocks()
  })

  it('opens from the header’s Search… button, which shows the shortcut', async () => {
    vi.spyOn(shortcut, 'paletteShortcutHint').mockReturnValue('Ctrl K')
    const user = userEvent.setup()
    renderShell('/dashboard')
    const button = await screen.findByRole('button', { name: /Search…/ })
    expect(within(button).getByText('Ctrl K')).toHaveAttribute('data-slot', 'kbd')
    await openPalette(user)
    expect(
      screen.getByRole('combobox', { name: 'Search pages, tenants and actions' })
    ).toHaveFocus()
  })

  it('fetches the palette’s code when the Search… button is hovered or focused', async () => {
    const user = userEvent.setup()
    renderShell('/dashboard')
    const button = await screen.findByRole('button', { name: /Search…/ })
    vi.mocked(prefetchPalette).mockClear()
    await user.hover(button)
    expect(prefetchPalette).toHaveBeenCalledTimes(1)
    vi.mocked(prefetchPalette).mockClear()
    button.focus()
    expect(prefetchPalette).toHaveBeenCalledTimes(1)
  })

  it('signs out, and is disabled while the sign-out is pending', async () => {
    // The request never answers, so the sign-out stays pending.
    server.use(http.post('/api/v1/auth/logout', () => new Promise<Response>(() => {})))
    const user = userEvent.setup()
    renderShell('/dashboard')
    const palette = await openPalette(user)
    const account = within(palette).getByRole('group', { name: 'Account' })
    await user.click(within(account).getByRole('option', { name: 'Sign out' }))
    await openPalette(user)
    expect(
      within(await screen.findByRole('group', { name: 'Account' })).getByRole('option', {
        name: 'Sign out',
      })
    ).toHaveAttribute('aria-disabled', 'true')
  })

  it('goes to every page, and leaves out the workspace sections with no current tenant', async () => {
    serveTenants(GAMMA, PLATFORM)
    const user = userEvent.setup()
    renderShell('/notifications')
    const palette = await openPalette(user)
    const goTo = within(palette).getByRole('group', { name: 'Go to' })
    expect(
      within(goTo)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual([
      'Dashboard',
      'Tenants',
      'Notifications',
      'Settings',
      'Profile',
      'Security',
      'Notification settings',
    ])
  })

  it('lists the workspace sections for the current tenant', async () => {
    const user = userEvent.setup()
    const router = renderShell('/notifications?tenant=acme')
    const palette = await openPalette(user)
    const goTo = within(palette).getByRole('group', { name: 'Go to' })
    expect(within(goTo).getByRole('option', { name: /^Members/ })).toHaveTextContent(
      'Members, Acme Corp'
    )
    await user.click(within(goTo).getByRole('option', { name: /^Members/ }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/settings/workspace/acme/members')
    )
  })

  it.each([
    ['a page without $slug', '/notifications?tenant=acme', '/notifications', { tenant: 'beta' }],
    ['a tenant page', '/tenants/acme', '/tenants/beta', {}],
    [
      'a workspace settings page',
      '/settings/workspace/acme/general',
      '/settings/workspace/beta/general',
      {},
    ],
  ])('switches tenant on %s as the switcher does', async (_label, from, pathname, search) => {
    const user = userEvent.setup()
    const router = renderShell(from)
    const palette = await openPalette(user)
    await user.keyboard('beta')
    const group = await within(palette).findByRole('group', { name: 'Switch tenant' })
    await user.click(within(group).getByRole('option', { name: /^Beta Inc/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe(pathname))
    expect(router.state.location.search).toMatchObject(search)
  })

  it('lists a suspended tenant as disabled, and never the platform tenant', async () => {
    const user = userEvent.setup()
    renderShell('/dashboard')
    const palette = await openPalette(user)
    await user.keyboard('a')
    const group = await within(palette).findByRole('group', { name: 'Switch tenant' })
    expect(within(group).getByRole('option', { name: /^Gamma Ltd/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(within(group).queryByRole('option', { name: /^Platform/ })).toBeNull()
  })

  it('creates a tenant on /tenants#create, with the first field focused', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const user = userEvent.setup()
    const router = renderShell('/dashboard')
    await openPalette(user)
    await user.keyboard('create')
    await user.click(await screen.findByRole('option', { name: 'Create a tenant' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/tenants'))
    expect(router.state.location.hash).toBe('create')
    try {
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus())
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
    } finally {
      // @ts-expect-error jsdom defines no scrollIntoView; removing the stub restores that.
      delete Element.prototype.scrollIntoView
    }
  })

  it('copies the current tenant’s ID', async () => {
    const user = userEvent.setup()
    renderShell('/tenants/acme')
    const palette = await openPalette(user)
    const page = await within(palette).findByRole('group', { name: 'This page' })
    await user.click(within(page).getByRole('option', { name: 'Copy tenant ID' }))
    await expect(navigator.clipboard.readText()).resolves.toBe(TENANT_ID)
    expect(await screen.findByText('Tenant ID copied.')).toBeInTheDocument()
  })

  it('sets the theme, marking the current one', async () => {
    useThemeStore.getState().setTheme('light')
    const user = userEvent.setup()
    renderShell('/dashboard')
    const palette = await openPalette(user)
    const theme = within(palette).getByRole('group', { name: 'Theme' })
    expect(within(theme).getByRole('option', { name: /^Light/ })).toHaveTextContent(
      'Light, Current'
    )
    await user.click(within(theme).getByRole('option', { name: /^Dark/ }))
    expect(useThemeStore.getState().theme).toBe('dark')
  })

  it('lists recent tenants still listed, other than the current one', async () => {
    recordRecent(testUser.id, { kind: 'tenant', id: BETA.id, label: 'Beta (old name)' })
    recordRecent(testUser.id, { kind: 'tenant', id: 'gone', label: 'Gone Co' })
    const user = userEvent.setup()
    renderShell('/notifications?tenant=acme')
    const palette = await openPalette(user)
    const recent = within(palette).getByRole('group', { name: 'Recent' })
    expect(
      within(recent)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['Beta Inc, beta'])
  })
})
