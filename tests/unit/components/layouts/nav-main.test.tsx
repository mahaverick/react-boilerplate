import { IconBell, IconLayoutDashboard, IconSettings } from '@tabler/icons-react'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { NavMain, type NavMainItem } from '@/components/layouts/nav-main'
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar'

const FLAT: NavMainItem[] = [
  { to: '/dashboard', label: 'Dashboard', Icon: IconLayoutDashboard },
  { to: '/notifications', label: 'Notifications', Icon: IconBell },
]

const GROUPED: NavMainItem[] = [
  ...FLAT,
  {
    to: '/tenants',
    label: 'Settings',
    Icon: IconSettings,
    items: [
      { to: '/profile', label: 'Profile' },
      { to: '/tenants', label: 'Tenants' },
    ],
  },
]

/** Shows the provider's open and drawer states, and opens the drawer, none of which NavMain does itself. */
function SidebarState() {
  const { state, openMobile, setOpenMobile } = useSidebar()
  return (
    <>
      <output aria-label="Sidebar state">{state}</output>
      <output aria-label="Drawer state">{openMobile ? 'open' : 'closed'}</output>
      <button type="button" onClick={() => setOpenMobile(true)}>
        Open drawer
      </button>
    </>
  )
}

/** Renders NavMain under a one-route router at `path`, so its `Link`s resolve. */
function renderNavAt(path: string, items: NavMainItem[], defaultOpen = true) {
  const rootRoute = createRootRoute({
    component: () => (
      <SidebarProvider defaultOpen={defaultOpen}>
        <NavMain items={items} pathname={path} />
        <SidebarState />
      </SidebarProvider>
    ),
  })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<RouterProvider router={router} />)
}

describe('NavMain', () => {
  const realInnerWidth = window.innerWidth

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: realInnerWidth })
  })

  it('renders flat items as links in the Main landmark, the current one active', async () => {
    renderNavAt('/notifications', FLAT)

    const nav = await screen.findByRole('navigation', { name: 'Main' })
    const notifications = within(nav).getByRole('link', { name: 'Notifications' })
    expect(notifications).toHaveAttribute('href', '/notifications')
    expect(notifications).toHaveAttribute('data-active')
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('data-active')
    // Flat items are links, not disclosure buttons.
    expect(within(nav).queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders an item with sub-items as a collapsible group, open while a sub-link is current', async () => {
    renderNavAt('/profile', GROUPED)

    const toggle = await screen.findByRole('button', { name: 'Settings' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('data-active')
    expect(screen.getByRole('link', { name: 'Tenants' })).not.toHaveAttribute('data-active')
  })

  it('keeps a group closed until it is toggled when none of its links is current', async () => {
    const user = userEvent.setup()
    renderNavAt('/dashboard', GROUPED)

    const toggle = await screen.findByRole('button', { name: 'Settings' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: 'Profile' })).not.toBeInTheDocument()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile')
  })

  it('expands a collapsed sidebar when a group is toggled, so its sub-links can be reached', async () => {
    const user = userEvent.setup()
    renderNavAt('/dashboard', GROUPED, false)

    const toggle = await screen.findByRole('button', { name: 'Settings' })
    const sidebarState = screen.getByLabelText('Sidebar state')
    expect(sidebarState).toHaveTextContent('collapsed')

    await user.click(toggle)
    expect(sidebarState).toHaveTextContent('expanded')
    expect(await screen.findByRole('link', { name: 'Profile' })).toBeInTheDocument()
  })

  it.each([
    ['a flat link', '/dashboard', 'Notifications'],
    ['a sub-link', '/profile', 'Tenants'],
  ])('closes the mobile drawer when %s is chosen', async (_kind, path, name) => {
    // The setup's matchMedia answers `max-width` queries from innerWidth, so this is a phone.
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 })
    const user = userEvent.setup()
    renderNavAt(path, GROUPED)

    await user.click(await screen.findByRole('button', { name: 'Open drawer' }))
    expect(screen.getByLabelText('Drawer state')).toHaveTextContent('open')

    await user.click(screen.getByRole('link', { name }))
    expect(screen.getByLabelText('Drawer state')).toHaveTextContent('closed')
  })
})
