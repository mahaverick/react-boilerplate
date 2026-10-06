import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { useMaintenanceModeStore } from '@/states/maintenance-mode.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

afterEach(() => {
  vi.restoreAllMocks()
})

function renderProfile() {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ['/profile'] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
}

describe('profile page', () => {
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    useMaintenanceModeStore.setState({ mode: 'off', message: null, since: null })
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
  })

  it('shows email and member-since as read-only facts', async () => {
    renderProfile()

    expect(await screen.findByText(testUser.email)).toBeInTheDocument()
    // Computed with the same formatter rather than hard-coded: a UTC midnight renders as the previous day in a US-timezone runner.
    const expected = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(
      new Date(testUser.createdAt)
    )
    expect(screen.getByText(expected)).toBeInTheDocument()
  })

  it('renders the Security section below the profile form', async () => {
    renderProfile()

    expect(await screen.findByRole('region', { name: 'Security' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Change password' })).toBeInTheDocument()
  })

  it('sends only the trimmed first and last name', async () => {
    let body: unknown
    server.use(
      http.patch('/api/v1/profile', async ({ request }) => {
        body = await request.json()
        return ok({ ...testUser, firstName: 'Ada', lastName: 'Lovelace' }, 'Profile updated.')
      })
    )
    const user = userEvent.setup()
    renderProfile()

    const first = await screen.findByLabelText('First name')
    await user.clear(first)
    await user.type(first, '  Ada  ')
    const last = screen.getByLabelText('Last name')
    await user.clear(last)
    await user.type(last, 'Lovelace')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(body).toEqual({ firstName: 'Ada', lastName: 'Lovelace' })
    })
    // The layout reads the user off the store, so the store has to move too.
    await waitFor(() => {
      expect(useAuthStore.getState().user?.firstName).toBe('Ada')
    })
  })

  it('refuses to submit an empty name without touching the network', async () => {
    let called = false
    server.use(
      http.patch('/api/v1/profile', () => {
        called = true
        return ok(testUser, 'Profile updated.')
      })
    )
    const user = userEvent.setup()
    renderProfile()

    await user.clear(await screen.findByLabelText('First name'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('First name is required.')).toBeInTheDocument()
    expect(called).toBe(false)
  })

  it("renders the server's field errors inline and clears one when it changes", async () => {
    server.use(
      http.patch('/api/v1/profile', () =>
        HttpResponse.json(
          {
            success: false,
            message: 'Validation failed.',
            statusCode: 400,
            errors: { firstName: ['That name is not allowed.'] },
            requestId: 'test-request-id',
          },
          { status: 400 }
        )
      )
    )
    const user = userEvent.setup()
    renderProfile()

    await user.click(await screen.findByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('That name is not allowed.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('First name'), 'a')
    await waitFor(() => {
      expect(screen.queryByText('That name is not allowed.')).not.toBeInTheDocument()
    })
  })

  it('shows an outright failure once, in the form, and leaves it usable', async () => {
    const toastError = vi.spyOn(toast, 'error')
    server.use(http.patch('/api/v1/profile', () => fail('Something broke.', 500)))
    const user = userEvent.setup()
    renderProfile()

    await user.click(await screen.findByRole('button', { name: 'Save changes' }))

    const message = await screen.findByText('Something broke.')
    expect(message.closest('form')).not.toBeNull()
    expect(screen.getAllByText('Something broke.')).toHaveLength(1)
    expect(toastError).not.toHaveBeenCalled()
    // Still on the page, still editable: the failure costs the user none of their typing.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    })
    expect(screen.getByLabelText('First name')).toHaveValue('A')
  })

  it('keeps what was typed when read-only maintenance refuses the save, and says why', async () => {
    server.use(
      http.patch('/api/v1/profile', () =>
        HttpResponse.json(
          {
            success: false,
            message: 'Upgrading the database. Back by 11:00.',
            statusCode: 503,
            code: 'READ_ONLY_MODE',
            mode: 'read_only',
            since: '2026-10-06T10:42:00.000Z',
            requestId: 'test-request-id',
          },
          { status: 503, headers: { 'Maintenance-Mode': 'read_only', 'Retry-After': '30' } }
        )
      ),
      http.get('/api/v1/status/maintenance', () =>
        ok(
          {
            mode: 'read_only',
            message: 'Upgrading the database. Back by 11:00.',
            since: '2026-10-06T10:42:00.000Z',
          },
          'Maintenance status retrieved.'
        )
      )
    )
    const user = userEvent.setup()
    renderProfile()

    const first = await screen.findByLabelText('First name')
    await user.clear(first)
    await user.type(first, 'Ada')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Changes are paused during maintenance.')).toBeInTheDocument()
    const banner = await screen.findByRole('region', { name: 'Maintenance' })
    expect(banner).toHaveTextContent('Upgrading the database. Back by 11:00.')
    expect(screen.getByLabelText('First name')).toHaveValue('Ada')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    expect(screen.getAllByText('Changes are paused during maintenance.')).toHaveLength(1)
  })
})
