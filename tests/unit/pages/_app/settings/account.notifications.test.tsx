import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http } from 'msw'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/** Mounts the real route tree on the notification settings. */
function renderPreferences() {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ['/settings/account/notifications'] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
}

describe('notification settings page', () => {
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

  afterEach(() => vi.restoreAllMocks())

  it('titles the page Notifications with the layout heading', async () => {
    renderPreferences()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Notifications' })
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Preferences' })
    ).toBeInTheDocument()
  })

  it('shows a retry, not an empty matrix, when the preferences fail to load', async () => {
    server.use(
      http.get('/api/v1/notifications/preferences', () => fail('Something went wrong', 500))
    )
    renderPreferences()

    expect(
      await screen.findByText(/could not load your notification preferences/i)
    ).toBeInTheDocument()
    expect(
      screen.queryByText('This account has no notification types yet.')
    ).not.toBeInTheDocument()
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
    renderPreferences()

    const main = await screen.findByRole('main')
    expect(await within(main).findByText('Verify email')).toBeInTheDocument()
    expect(within(main).getByText('Email: On')).toBeInTheDocument()
    expect(
      within(main).getByText(/email for these notifications cannot be turned off/i)
    ).toBeInTheDocument()
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
    renderPreferences()
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

  it('disables the switch while pending, and a second click or key press sends nothing', async () => {
    const user = userEvent.setup()
    useOnePreference(true)
    let puts = 0
    server.use(
      http.put('/api/v1/notifications/preferences', () => {
        puts += 1
        return delay('infinite')
      })
    )
    renderPreferences()

    await user.click(await screen.findByRole('switch', { name: /Verify email/ }))
    // The disabled state is the barrier: past it, the click and keys below land on a disabled switch.
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /Verify email/ })).toHaveAttribute(
        'aria-disabled',
        'true'
      )
    )
    const toggle = screen.getByRole('switch', { name: /Verify email/ })
    await user.click(toggle)
    toggle.focus()
    await user.keyboard(' ')
    await user.keyboard('{Enter}')

    expect(puts).toBe(1)
    expect(screen.getByRole('switch', { name: /Verify email/ })).not.toBeChecked()
  })

  it('toggles from the keyboard with Space', async () => {
    const user = userEvent.setup()
    let body: unknown
    useOnePreference(false)
    server.use(
      http.put('/api/v1/notifications/preferences', async ({ request }) => {
        body = await request.json()
        return ok({ preferences: [] }, 'Notification preferences updated.')
      })
    )
    renderPreferences()
    const toggle = await screen.findByRole('switch', { name: /Verify email/ })

    toggle.focus()
    await user.keyboard(' ')

    await waitFor(() =>
      expect(body).toEqual({
        preferences: [{ notificationType: 'verify_email', emailEnabled: true, inAppEnabled: true }],
      })
    )
  })

  it('shows the API message and reverts the row when the PUT answers 400', async () => {
    const user = userEvent.setup()
    useOnePreference(true)
    const error = vi.spyOn(toast, 'error')
    let released = false
    server.use(
      http.put('/api/v1/notifications/preferences', async () => {
        while (!released) await delay(10)
        return fail('This notification type does not exist.', 400)
      })
    )
    renderPreferences()

    await user.click(await screen.findByRole('switch', { name: /Verify email/ }))
    // Held at the gate, the row shows the requested state.
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /Verify email/ })).not.toBeChecked()
    )
    released = true

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
    renderPreferences()

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
    renderPreferences()

    const main = await screen.findByRole('main')
    expect(await within(main).findByText('Maintenance mode changed')).toBeInTheDocument()
  })
})
