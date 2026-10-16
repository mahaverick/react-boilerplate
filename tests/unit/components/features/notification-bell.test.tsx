import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
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

/**
 * Mounts the real route tree on `/dashboard` rather than the bell alone: the bell is in the
 * app shell's header (`app-layout.tsx`), so it is on every authenticated page and a false
 * empty state here would reach all of them.
 */
function renderShell() {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ['/dashboard'] }),
    ...ROUTER_DEFAULTS,
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
}

/** Opens the menu, whose contents exist only while open. The trigger's accessible name changes with the state under test, so it is matched on its stable prefix. */
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
   * `DropdownMenuLabel` is Base UI's `Menu.GroupLabel`, which throws "MenuGroupContext is
   * missing" unless a `Menu.Group` is above it. A wrong composition throws on every route
   * and the root boundary replaces the app with "Something went wrong!", while a closed
   * menu still has its accessible name, so only opening it catches this.
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
        ok(listPage([unreadRow], {}, { count: 1, capped: false }), 'Notifications retrieved.')
      )
    )
    renderShell()
    await openBell()

    expect(await screen.findByRole('menuitem', { name: /Verify your email/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument()
  })

  it('asks for five rows to preview and one unread row for the count', async () => {
    const seen: URLSearchParams[] = []
    server.use(
      http.get('/api/v1/notifications', ({ request }) => {
        seen.push(new URL(request.url).searchParams)
        return ok(listPage([unreadRow]), 'Notifications retrieved.')
      })
    )
    renderShell()
    await screen.findByRole('button', { name: /^Notifications,/ })
    await waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(2))
    // The preview never reads its total, so it does not pay for the count.
    expect(
      seen.some(
        (p) => p.get('limit') === '5' && p.get('unread') === null && p.get('total') === null
      )
    ).toBe(true)
    expect(
      seen.some(
        (p) => p.get('unread') === 'true' && p.get('limit') === '1' && p.get('total') === '1'
      )
    ).toBe(true)
  })

  it.each([
    [{ count: 3, capped: false }, 'Notifications, 3 unread'],
    [{ count: 1000, capped: true }, 'Notifications, 1,000+ unread'],
  ])('names the bell from the API total %j', async (total, name) => {
    server.use(
      http.get('/api/v1/notifications', () =>
        ok(listPage([unreadRow], {}, total), 'Notifications retrieved.')
      )
    )
    renderShell()
    expect(await screen.findByRole('button', { name })).toBeVisible()
  })

  /**
   * The default handler answers an empty page, so this is the genuine empty case. Without
   * this half, the failure test below could pass by never claiming emptiness at all.
   */
  it('says the inbox is empty when it really is empty', async () => {
    renderShell()
    await openBell()

    expect(await screen.findByText('You have no notifications.')).toBeInTheDocument()
    expect(screen.queryByText('Notifications could not be loaded.')).not.toBeInTheDocument()
    // A zero count that a request established is announced.
    expect(
      await screen.findByRole('button', { name: 'Notifications, 0 unread' })
    ).toBeInTheDocument()
  })

  /**
   * An absent page is `[]` for a failed load exactly as for an empty inbox, so
   * without this the menu would say "You have no notifications." on the strength of a
   * request that never answered, while `/notifications` shows an error for the same query.
   */
  it('says the list FAILED, not that the inbox is empty, when the query errors', async () => {
    server.use(http.get('/api/v1/notifications', () => fail('Something went wrong', 500)))
    renderShell()
    await openBell()

    // The queryClient is `retry: 1`, so the error state arrives only after a second attempt; tests/setup.ts removes the backoff between the two.
    expect(await screen.findByText('Notifications could not be loaded.')).toBeInTheDocument()
    expect(screen.queryByText('You have no notifications.')).not.toBeInTheDocument()
    // The label must not announce a count nothing established: "0 unread" would be the same false claim, read by a screen reader on every page.
    expect(screen.getByRole('button', { name: 'Notifications, count unavailable' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Notifications, 0 unread' })
    ).not.toBeInTheDocument()
  })

  // Mirrors the tenant switcher's loading branch: a menu opened mid-flight must not claim an empty inbox.
  it('says the list is still loading when the menu opens mid-flight', async () => {
    server.use(http.get('/api/v1/notifications', async () => delay('infinite')))
    renderShell()
    await openBell()

    expect(await screen.findByText('Loading notifications…')).toBeInTheDocument()
    expect(screen.queryByText('You have no notifications.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Notifications, count unavailable' })).toBeVisible()
  })

  it('marks a failed read on the bell, and Try again reads again', async () => {
    let failing = true
    server.use(
      http.get('/api/v1/notifications', ({ request }) => {
        if (failing) return fail('Something went wrong', 500)
        const unreadOnly = new URL(request.url).searchParams.get('unread') === 'true'
        return ok(
          listPage([unreadRow], {}, unreadOnly ? { count: 1, capped: false } : undefined),
          'Notifications retrieved.'
        )
      })
    )
    renderShell()
    const bell = await screen.findByRole('button', { name: 'Notifications, count unavailable' })
    await waitFor(() => expect(bell.querySelector('[data-slot="bell-unavailable"]')).not.toBeNull())
    const user = await openBell()
    // Both reads have failed their retries once the menu says so; only then do they succeed.
    await screen.findByText('Notifications could not be loaded.')
    failing = false
    await user.click(await screen.findByRole('menuitem', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible()
  })

  it('offers Try again for the count alone when only the count read failed', async () => {
    let failing = true
    server.use(
      http.get('/api/v1/notifications', ({ request }) => {
        const unreadOnly = new URL(request.url).searchParams.get('unread') === 'true'
        if (unreadOnly && failing) return fail('Something went wrong', 500)
        return ok(
          listPage([unreadRow], {}, unreadOnly ? { count: 1, capped: false } : undefined),
          'Notifications retrieved.'
        )
      })
    )
    renderShell()
    const bell = await screen.findByRole('button', { name: 'Notifications, count unavailable' })
    await waitFor(() => expect(bell.querySelector('[data-slot="bell-unavailable"]')).not.toBeNull())
    const user = await openBell()
    expect(await screen.findByRole('menuitem', { name: /Verify your email/ })).toBeInTheDocument()
    failing = false
    await user.click(await screen.findByRole('menuitem', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible()
  })

  it('reads "count unavailable", not "0 unread", for a count answer with no total, and offers Try again', async () => {
    server.use(
      http.get('/api/v1/notifications', () => ok(listPage([unreadRow]), 'Notifications retrieved.'))
    )
    renderShell()
    const bell = await screen.findByRole('button', { name: 'Notifications, count unavailable' })
    await waitFor(() => expect(bell.querySelector('[data-slot="bell-unavailable"]')).not.toBeNull())
    await openBell()
    expect(await screen.findByRole('menuitem', { name: 'Try again' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Notifications, 0 unread' })
    ).not.toBeInTheDocument()
  })

  it('does not mark a read that is still in flight', async () => {
    server.use(http.get('/api/v1/notifications', async () => delay('infinite')))
    renderShell()
    const bell = await screen.findByRole('button', { name: 'Notifications, count unavailable' })
    expect(bell.querySelector('[data-slot="bell-unavailable"]')).toBeNull()
  })
})
