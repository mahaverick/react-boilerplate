import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http } from 'msw'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import type { Notification } from '@/queries/notification.queries'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { NOTIFICATION_ID } from '@/tests/fixtures/ids'
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

  afterEach(() => vi.restoreAllMocks())

  /**
   * Both cards state the failure rather than the absence. `rows` is `[]` and
   * `preferences.data` is undefined for a failed load exactly as for an empty one, so without
   * this the page would answer a 500 with "You have no notifications." and "This account has
   * no notification types yet.", two claims the request never established.
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

  it('shows a retry, not an empty matrix, when the preferences fail to load', async () => {
    server.use(
      http.get('/api/v1/notifications/preferences', () => fail('Something went wrong', 500))
    )
    renderNotifications()

    expect(
      await screen.findByText(/could not load your notification preferences/i)
    ).toBeInTheDocument()
    expect(
      screen.queryByText('This account has no notification types yet.')
    ).not.toBeInTheDocument()
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

  /** A matrix with one type whose in-app copy is on. */
  function useOnePreference(inAppEnabled: boolean) {
    server.use(
      http.get('/api/v1/notifications/preferences', () =>
        ok(
          { preferences: [{ notificationType: 'verify_email', emailEnabled: true, inAppEnabled }] },
          'Notification preferences retrieved.'
        )
      )
    )
  }

  it('shows email as fixed text and the in-app copy as a named switch', async () => {
    useOnePreference(false)
    renderNotifications()

    const main = await screen.findByRole('main')
    expect(await within(main).findByText('Verify email')).toBeInTheDocument()
    expect(within(main).getByText('Email: On')).toBeInTheDocument()
    expect(
      within(main).getByText(/email for these notifications cannot be turned off/i)
    ).toBeInTheDocument()
    expect(within(main).queryByText(/not configurable yet/i)).not.toBeInTheDocument()
    expect(within(main).getAllByRole('switch')).toHaveLength(1)
    expect(within(main).getByRole('switch', { name: /Verify email/ })).not.toBeChecked()
  })

  it('PUTs the whole entry with emailEnabled true and updates the row', async () => {
    const user = userEvent.setup()
    let stored = false
    let body: unknown
    server.use(
      http.get('/api/v1/notifications/preferences', () =>
        ok(
          {
            preferences: [
              { notificationType: 'verify_email', emailEnabled: true, inAppEnabled: stored },
            ],
          },
          'Notification preferences retrieved.'
        )
      ),
      http.put('/api/v1/notifications/preferences', async ({ request }) => {
        body = await request.json()
        stored = true
        return ok({ preferences: [] }, 'Notification preferences updated.')
      })
    )
    renderNotifications()
    const toggle = await screen.findByRole('switch', { name: /Verify email/ })
    expect(toggle).not.toBeChecked()

    await user.click(toggle)

    await waitFor(() => expect(screen.getByRole('switch', { name: /Verify email/ })).toBeChecked())
    expect(body).toEqual({
      preferences: [{ notificationType: 'verify_email', emailEnabled: true, inAppEnabled: true }],
    })
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /Verify email/ })).not.toHaveAttribute(
        'aria-disabled',
        'true'
      )
    )
  })

  it('disables the switch while the request is pending', async () => {
    const user = userEvent.setup()
    useOnePreference(true)
    server.use(http.put('/api/v1/notifications/preferences', () => delay('infinite')))
    renderNotifications()

    await user.click(await screen.findByRole('switch', { name: /Verify email/ }))

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /Verify email/ })).toHaveAttribute(
        'aria-disabled',
        'true'
      )
    )
  })

  it('shows the API message and reverts the row when the PUT answers 400', async () => {
    const user = userEvent.setup()
    useOnePreference(true)
    const error = vi.spyOn(toast, 'error')
    server.use(
      http.put('/api/v1/notifications/preferences', () =>
        fail('This notification type does not exist.', 400)
      )
    )
    renderNotifications()

    await user.click(await screen.findByRole('switch', { name: /Verify email/ }))

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith('This notification type does not exist.')
    )
    await waitFor(() => {
      const toggle = screen.getByRole('switch', { name: /Verify email/ })
      expect(toggle).not.toHaveAttribute('aria-disabled', 'true')
      expect(toggle).toBeChecked()
    })
  })

  it('lists only the types the API sends, so a customer sees no maintenance row', async () => {
    // Express omits the staff-only `maintenance_mode_changed` type for a user with no platform membership.
    server.use(
      http.get('/api/v1/notifications/preferences', () =>
        ok(
          {
            preferences: [
              { notificationType: 'verify_email', emailEnabled: true, inAppEnabled: true },
            ],
          },
          'Notification preferences retrieved.'
        )
      )
    )
    renderNotifications()

    const main = await screen.findByRole('main')
    expect(await within(main).findByText('Verify email')).toBeInTheDocument()
    expect(within(main).queryByText(/maintenance/i)).not.toBeInTheDocument()
  })

  it('lists the maintenance type when the API sends it, as it does for staff', async () => {
    server.use(
      http.get('/api/v1/notifications/preferences', () =>
        ok(
          {
            preferences: [
              {
                notificationType: 'maintenance_mode_changed',
                emailEnabled: true,
                inAppEnabled: true,
              },
            ],
          },
          'Notification preferences retrieved.'
        )
      )
    )
    renderNotifications()

    const main = await screen.findByRole('main')
    expect(await within(main).findByText('Maintenance mode changed')).toBeInTheDocument()
  })

  it('says so when the inbox is empty', async () => {
    server.use(http.get('/api/v1/notifications', () => ok({ notifications: [] }, 'Retrieved.')))
    renderNotifications()

    const main = await screen.findByRole('main')
    expect(await within(main).findByText('You have no notifications.')).toBeInTheDocument()
  })
})
