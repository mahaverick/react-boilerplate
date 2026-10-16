import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import type { Notification } from '@/queries/notification.queries'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { NOTIFICATION_ID } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const unreadRow: Notification = {
  id: NOTIFICATION_ID,
  userId: testUser.id,
  type: 'verify_email',
  title: 'Verify your email',
  body: 'Follow the link we sent you.',
  metadata: null,
  readAt: null,
  createdAt: '2026-09-21T10:00:00.000Z',
}

/** Mounts the real route tree on `/notifications`. */
function renderNotifications() {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ['/notifications'] }),
    ...ROUTER_DEFAULTS,
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
}

describe('notifications page', () => {
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    server.use(
      http.get('/api/v1/notifications', () =>
        ok(listPage([unreadRow], {}, { count: 1, capped: false }), 'Notifications retrieved.')
      )
    )
  })

  afterEach(() => vi.restoreAllMocks())

  /**
   * The inbox states the failure rather than the absence. `rows` is `[]` for a failed load
   * exactly as for an empty one, so without this the page would answer a 500 with "You have no
   * notifications.", a claim the request never established.
   */
  it('shows a retry, not an empty inbox, when the list fails to load', async () => {
    server.use(http.get('/api/v1/notifications', () => fail('Something went wrong', 500)))
    renderNotifications()

    const alerts = await screen.findAllByRole('alert')
    const inbox = alerts.find((alert) =>
      /could not load your notifications/i.test(alert.textContent ?? '')
    )
    expect(inbox).toBeDefined()
    expect(within(inbox!).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByText('You have no notifications.')).not.toBeInTheDocument()
  })

  it('shows the inbox as cards at every width, with a search box and paging', async () => {
    renderNotifications()
    const cards = await screen.findByRole('list', { name: 'Notifications' })
    expect(within(cards).getByRole('listitem')).toHaveTextContent('Verify your email')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search notifications' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Notifications pagination' })).toBeInTheDocument()
  })

  it('shows only unread notifications through ?unread=true', async () => {
    const seen: URLSearchParams[] = []
    server.use(
      http.get('/api/v1/notifications', ({ request }) => {
        seen.push(new URL(request.url).searchParams)
        return ok(listPage([unreadRow]), 'Notifications retrieved.')
      })
    )
    const user = userEvent.setup()
    renderNotifications()
    await screen.findByRole('list', { name: 'Notifications' })
    await user.click(screen.getByRole('button', { name: 'Filter by status' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by status' })
    await user.click(within(popup).getByRole('checkbox', { name: 'Unread' }))
    await waitFor(() =>
      expect(
        seen.some((params) => params.get('unread') === 'true' && params.get('limit') !== '1')
      ).toBe(true)
    )
  })

  it('searches the title and the text, and says only that', async () => {
    const seen: URLSearchParams[] = []
    server.use(
      http.get('/api/v1/notifications', ({ request }) => {
        seen.push(new URL(request.url).searchParams)
        return ok(listPage([unreadRow]), 'Notifications retrieved.')
      })
    )
    const user = userEvent.setup()
    renderNotifications()
    const box = await screen.findByRole('searchbox', { name: 'Search notifications' })
    expect(box).toHaveAttribute('placeholder', 'Search by title or text')
    await user.type(box, 'verify')
    await waitFor(() => expect(seen.some((params) => params.get('search') === 'verify')).toBe(true))
  })

  it('refreshes the badge, the bell and the inbox when a row is marked read', async () => {
    let unread = 1
    const reads: URLSearchParams[] = []
    server.use(
      http.get('/api/v1/notifications', ({ request }) => {
        const params = new URL(request.url).searchParams
        reads.push(params)
        const row = unread === 1 ? unreadRow : { ...unreadRow, readAt: '2026-09-21T11:00:00.000Z' }
        return ok(listPage([row], {}, { count: unread, capped: false }), 'Notifications retrieved.')
      }),
      http.patch('/api/v1/notifications/:id/read', () => {
        unread = 0
        return ok({ ...unreadRow, readAt: '2026-09-21T11:00:00.000Z' }, 'Marked.')
      })
    )
    const user = userEvent.setup()
    renderNotifications()
    await screen.findByRole('button', { name: 'Notifications, 1 unread' })
    await user.click(
      await screen.findByRole('button', { name: `Mark "${unreadRow.title}" as read` })
    )
    expect(await screen.findByRole('button', { name: 'Notifications, 0 unread' })).toBeVisible()
    await waitFor(() => expect(screen.queryByText('Unread')).not.toBeInTheDocument())
  })

  it('lists the inbox under a level-one heading', async () => {
    renderNotifications()

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Notifications')
    expect(await screen.findByText(unreadRow.title)).toBeInTheDocument()
  })

  it('names the bell with its unread count, since a badge is not a name', async () => {
    renderNotifications()

    // Base UI's Tooltip emits no role="tooltip" and no aria-describedby, so this label is the only accessible name axe can read.
    expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible()
  })

  it('marks a row read optimistically, before the server answers', async () => {
    const user = userEvent.setup()
    renderNotifications()
    await screen.findByText(unreadRow.title)

    // Never resolves, so whatever the UI shows after the click is the optimistic cache write, not a server round trip.
    server.use(http.patch('/api/v1/notifications/:id/read', () => delay('infinite')))

    await user.click(screen.getByRole('button', { name: `Mark "${unreadRow.title}" as read` }))

    await waitFor(() => expect(screen.queryByText('Unread')).not.toBeInTheDocument())
  })

  it('restores the snapshot when a mark-read fails', async () => {
    const user = userEvent.setup()
    renderNotifications()
    await screen.findByText(unreadRow.title)

    server.use(
      http.patch('/api/v1/notifications/:id/read', () => fail('Notification not found', 404)),
      // The rollback must put the Unread badge back: onSettled's invalidation fires too, and a refetch that answered would hide whether onError restored anything.
      http.get('/api/v1/notifications', () => delay('infinite'))
    )

    await user.click(screen.getByRole('button', { name: `Mark "${unreadRow.title}" as read` }))

    await waitFor(() => expect(screen.getByText('Unread')).toBeInTheDocument())
    expect(
      screen.getByRole('button', { name: `Mark "${unreadRow.title}" as read` })
    ).toBeInTheDocument()
  })

  it('keeps the title and the Unread badge in one flex wrapper', async () => {
    renderNotifications()

    const badge = await screen.findByText('Unread')
    const wrapper = badge.parentElement
    expect(wrapper).toHaveClass('flex', 'flex-wrap', 'gap-2')
    expect(wrapper).toContainElement(screen.getByRole('heading', { name: unreadRow.title }))
  })

  it('restores the snapshot when a delete fails', async () => {
    const user = userEvent.setup()
    renderNotifications()
    await screen.findByText(unreadRow.title)

    server.use(
      http.delete('/api/v1/notifications/:id', () => fail('Notification not found', 404)),
      // The rollback must put this row back: onSettled's invalidation fires too, and a refetch that answered would hide whether onError restored anything.
      http.get('/api/v1/notifications', () => delay('infinite'))
    )

    await user.click(screen.getByRole('button', { name: `Delete "${unreadRow.title}"` }))

    await waitFor(() => expect(screen.getByText(unreadRow.title)).toBeInTheDocument())
    expect(screen.getByText('Unread')).toBeInTheDocument()
  })

  it('links to the notification settings', async () => {
    renderNotifications()

    expect(await screen.findByRole('link', { name: 'Notification settings' })).toHaveAttribute(
      'href',
      '/settings/account/notifications'
    )
  })

  it('says so when the inbox is empty', async () => {
    server.use(http.get('/api/v1/notifications', () => ok(listPage([]), 'Retrieved.')))
    renderNotifications()

    const main = await screen.findByRole('main')
    expect(await within(main).findByText('You have no notifications.')).toBeInTheDocument()
  })
})
