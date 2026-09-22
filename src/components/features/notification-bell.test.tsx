import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
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

/**
 * Driven through a real RouterProvider on `/dashboard`, not by rendering the
 * bell standalone: it lives in the app shell's header (`app-layout.tsx`), so
 * it is mounted on EVERY authenticated page — which is what made its false
 * empty state the widest-reaching of the five.
 */
function renderShell() {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ['/dashboard'] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
}

/**
 * The menu's contents only exist once it is open, and the trigger's accessible
 * name CHANGES with the state under test — so it is matched on its stable
 * prefix rather than on the whole label.
 */
async function openBell() {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /^Notifications,/ }))
  return user
}

describe('NotificationBell', () => {
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

  /**
   * THE MENU OPENS AT ALL. Not a tautology — it did not.
   *
   * `DropdownMenuLabel` is Base UI's `Menu.GroupLabel`, which throws
   * "MenuGroupContext is missing" unless a `Menu.Group` is above it, and this
   * menu had none. Clicking the bell therefore threw on every route and the
   * root boundary replaced the app with "Something went wrong!". The whole
   * suite stayed green through it because no test had ever opened this menu —
   * the only assertion on the bell was its trigger's accessible name, which a
   * closed menu satisfies. Found while writing the error-state tests below,
   * which could not otherwise reach the states they are about.
   */
  it('opens without taking the page down with it', async () => {
    renderShell()
    await openBell()

    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'View all notifications' })).toBeInTheDocument()
  })

  it('previews the notifications it has', async () => {
    server.use(
      http.get('/api/v1/notifications', () =>
        ok({ notifications: [unreadRow] }, 'Notifications retrieved.')
      )
    )
    renderShell()
    await openBell()

    expect(await screen.findByRole('menuitem', { name: /Verify your email/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument()
  })

  // The default handler answers an empty page, so this is the genuine
  // "nothing has been sent to you" case — and it must keep saying so. Without
  // this half, the fix below could be "never claim emptiness" rather than
  // "claim it only when it is true".
  it('says the inbox is empty when it really is empty', async () => {
    renderShell()
    await openBell()

    expect(await screen.findByText('You have no notifications.')).toBeInTheDocument()
    expect(screen.queryByText('Notifications could not be loaded.')).not.toBeInTheDocument()
    // A count of zero that a request actually established IS announced.
    expect(screen.getByRole('button', { name: 'Notifications, 0 unread' })).toBeInTheDocument()
  })

  /**
   * The FIFTH false-empty surface, and the one on every page.
   *
   * `flattenPages(undefined)` is `[]` for a failed load exactly as it is for
   * an empty inbox, so this menu stated "You have no notifications." on the
   * strength of a request that never answered — and did it in the same layout
   * in which `/notifications` was rendering its own error about the SAME
   * query.
   */
  it('says the list FAILED, not that the inbox is empty, when the query errors', async () => {
    server.use(http.get('/api/v1/notifications', () => fail('Something went wrong', 500)))
    renderShell()
    await openBell()

    // Generous: the queryClient is `retry: 1`, so a failed load is attempted a
    // second time (after react-query's ~1s backoff) before the error state is
    // reached at all.
    expect(
      await screen.findByText('Notifications could not be loaded.', {}, { timeout: 5000 })
    ).toBeInTheDocument()
    expect(screen.queryByText('You have no notifications.')).not.toBeInTheDocument()
    // And the label does not announce a figure nothing established. "0 unread"
    // here would be the same lie the menu text used to tell, told to a screen
    // reader on every page in the app.
    expect(screen.getByRole('button', { name: 'Notifications, count unavailable' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Notifications, 0 unread' })
    ).not.toBeInTheDocument()
  })

  // Beyond the error/empty pair, and the same branch Minor 3 adds to the
  // tenant switcher: a menu opened mid-flight claimed an empty inbox too.
  it('says the list is still loading when the menu opens mid-flight', async () => {
    server.use(http.get('/api/v1/notifications', async () => delay('infinite')))
    renderShell()
    await openBell()

    expect(await screen.findByText('Loading notifications…')).toBeInTheDocument()
    expect(screen.queryByText('You have no notifications.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Notifications, count unavailable' })).toBeVisible()
  })
})
