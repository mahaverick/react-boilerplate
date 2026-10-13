import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NavSettings } from '@/components/layouts/nav-settings'
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar'

/** The slug the mocked `useWorkspaceSlug` returns; each test sets it. */
const workspace = vi.hoisted(() => ({ slug: null as string | null }))

vi.mock('@/hooks/use-workspace-slug', () => ({
  useWorkspaceSlug: () => workspace.slug,
}))

/** Shows the provider's drawer state, and opens the drawer, neither of which NavSettings does itself. */
function DrawerState() {
  const { openMobile, setOpenMobile } = useSidebar()
  return (
    <>
      <output aria-label="Drawer state">{openMobile ? 'open' : 'closed'}</output>
      <button type="button" onClick={() => setOpenMobile(true)}>
        Open drawer
      </button>
    </>
  )
}

/**
 * Renders NavSettings under a one-route router at `path`, so its `Link`s resolve and a
 * click moves the router's location; the nav reads `path` as its pathname, as AppLayout
 * passes the location's.
 */
function renderNavAt(path: string, defaultOpen = true): AnyRouter {
  const rootRoute = createRootRoute({
    component: () => (
      <SidebarProvider defaultOpen={defaultOpen}>
        <NavSettings pathname={path} />
        <DrawerState />
      </SidebarProvider>
    ),
  })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<RouterProvider router={router} />)
  return router as AnyRouter
}

describe('NavSettings', () => {
  const realInnerWidth = window.innerWidth

  beforeEach(() => {
    workspace.slug = null
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: realInnerWidth })
  })

  it('leads with Back to app, then labelled Account and Workspace groups', async () => {
    workspace.slug = 'acme'
    renderNavAt('/settings/account/profile')

    const nav = await screen.findByRole('navigation', { name: 'Settings' })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent)
    ).toEqual([
      'Back to app',
      'Profile',
      'Security',
      'Notifications',
      'General',
      'Members',
      'Activity',
    ])
    expect(within(nav).getByRole('link', { name: 'Back to app' })).toHaveAttribute(
      'href',
      '/dashboard'
    )
    expect(within(nav).getByText('Account')).toBeInTheDocument()
    expect(within(nav).getByText('Workspace')).toBeInTheDocument()
  })

  it('marks the current account section active, and no other', async () => {
    renderNavAt('/settings/account/security')

    const nav = await screen.findByRole('navigation', { name: 'Settings' })
    expect(within(nav).getByRole('link', { name: 'Security' })).toHaveAttribute('data-active')
    expect(within(nav).getByRole('link', { name: 'Profile' })).not.toHaveAttribute('data-active')
    expect(within(nav).getByRole('link', { name: 'Back to app' })).not.toHaveAttribute(
      'data-active'
    )
  })

  it('links workspace sections to the resolved tenant and marks the current one active', async () => {
    workspace.slug = 'acme'
    renderNavAt('/settings/workspace/acme/members')

    const nav = await screen.findByRole('navigation', { name: 'Settings' })
    expect(within(nav).getByRole('link', { name: 'General' })).toHaveAttribute(
      'href',
      '/settings/workspace/acme/general'
    )
    const members = within(nav).getByRole('link', { name: 'Members' })
    expect(members).toHaveAttribute('href', '/settings/workspace/acme/members')
    expect(members).toHaveAttribute('data-active')
    expect(within(nav).getByRole('link', { name: 'Activity' })).not.toHaveAttribute('data-active')
    expect(within(nav).queryByText('Choose a tenant first.')).not.toBeInTheDocument()
  })

  it('disables every workspace item, with a hint, when there is no tenant', async () => {
    renderNavAt('/settings/account/profile')

    const nav = await screen.findByRole('navigation', { name: 'Settings' })
    for (const name of ['General', 'Members', 'Activity']) {
      expect(within(nav).queryByRole('link', { name })).not.toBeInTheDocument()
      expect(within(nav).getByRole('button', { name })).toHaveAttribute('aria-disabled', 'true')
    }
    expect(within(nav).getByText('Choose a tenant first.')).toBeInTheDocument()
    // Account items stay links.
    expect(within(nav).getByRole('link', { name: 'Profile' })).toBeInTheDocument()
  })

  it('does nothing when a disabled item is clicked or pressed, though it stays focusable', async () => {
    const user = userEvent.setup()
    const router = renderNavAt('/settings/account/profile')

    const members = await screen.findByRole('button', { name: 'Members' })
    await user.click(members)
    members.focus()
    expect(members).toHaveFocus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')

    expect(router.state.location.pathname).toBe('/settings/account/profile')
    expect(members).toHaveAttribute('aria-disabled', 'true')
  })

  it('says to choose a tenant first in a disabled item’s tooltip while collapsed to icons', async () => {
    const user = userEvent.setup()
    renderNavAt('/settings/account/profile', false)

    await user.hover(await screen.findByRole('button', { name: 'Members' }))

    await waitFor(() => {
      const tooltip = document.querySelector('[data-slot="tooltip-content"]')
      expect(tooltip).toHaveTextContent('Choose a tenant first.')
    })
  })

  it.each(['Back to app', 'Profile', 'Members'])(
    'closes the mobile drawer when %s is chosen',
    async (name) => {
      workspace.slug = 'acme'
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 })
      const user = userEvent.setup()
      renderNavAt('/settings/account/security')

      await user.click(await screen.findByRole('button', { name: 'Open drawer' }))
      expect(screen.getByLabelText('Drawer state')).toHaveTextContent('open')

      await user.click(screen.getByRole('link', { name }))
      expect(screen.getByLabelText('Drawer state')).toHaveTextContent('closed')
    }
  )
})
