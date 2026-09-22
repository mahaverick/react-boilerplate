import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import type { Notification } from '@/queries/notification.queries'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const unreadRow: Notification = {
  id: 'n1',
  userId: testUser.id,
  type: 'verify_email',
  title: 'Verify your email',
  body: 'Follow the link we sent you.',
  metadata: null,
  readAt: null,
  createdAt: '2026-09-21T10:00:00.000Z',
}

function renderNotifications() {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ['/notifications'] }),
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
        ok({ notifications: [unreadRow] }, 'Notifications retrieved.')
      )
    )
  })

  it('lists the inbox under a level-one heading', async () => {
    renderNotifications()

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Notifications')
    expect(await screen.findByText(unreadRow.title)).toBeInTheDocument()
  })

  it('names the bell with its unread count, since a badge is not a name', async () => {
    renderNotifications()

    // Base UI's Tooltip emits no role="tooltip" and no aria-describedby, so
    // this label is the only accessible name Task 9's axe run can read.
    expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible()
  })

  it('marks a row read optimistically, before the server answers', async () => {
    const user = userEvent.setup()
    renderNotifications()
    await screen.findByText(unreadRow.title)

    // Never resolves: anything the UI shows after the click is therefore the
    // optimistic cache write, not a server round trip.
    server.use(http.patch('/api/v1/notifications/:id/read', () => delay('infinite')))

    await user.click(screen.getByRole('button', { name: `Mark "${unreadRow.title}" as read` }))

    await waitFor(() => expect(screen.queryByText('Unread')).not.toBeInTheDocument())
  })

  it('restores the snapshot when a delete fails', async () => {
    const user = userEvent.setup()
    renderNotifications()
    await screen.findByText(unreadRow.title)

    server.use(
      http.delete('/api/v1/notifications/:id', () => fail('Notification not found', 404)),
      // The rollback is what has to put this row back: onSettled's
      // invalidation fires too, and a refetch that answered would hide
      // whether onError restored anything.
      http.get('/api/v1/notifications', () => delay('infinite'))
    )

    await user.click(screen.getByRole('button', { name: `Delete "${unreadRow.title}"` }))

    await waitFor(() => expect(screen.getByText(unreadRow.title)).toBeInTheDocument())
    expect(screen.getByText('Unread')).toBeInTheDocument()
  })

  it('says so when the inbox is empty', async () => {
    server.use(http.get('/api/v1/notifications', () => ok({ notifications: [] }, 'Retrieved.')))
    renderNotifications()

    const main = await screen.findByRole('main')
    expect(await within(main).findByText('You have no notifications.')).toBeInTheDocument()
  })
})
