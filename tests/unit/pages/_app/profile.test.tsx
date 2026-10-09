import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { profileKeys } from '@/queries/profile.queries'
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

  /** A stored first name the name rule now refuses, saved before the rule existed. */
  function mockLegacyName() {
    const legacy = { ...testUser, firstName: 'Ad\u{200B}a', lastName: 'Byron' }
    useAuthStore.setState({ user: legacy })
    server.use(http.get('/api/v1/profile', () => ok(legacy, 'Profile retrieved.')))
  }

  it('saves an edited last name while a refused legacy first name stays as it is', async () => {
    mockLegacyName()
    let body: unknown = null
    server.use(
      http.patch('/api/v1/profile', async ({ request }) => {
        body = await request.json()
        return ok({ ...testUser, lastName: 'Lovelace' }, 'Profile updated.')
      })
    )
    const user = userEvent.setup()
    renderProfile()

    const first = await screen.findByLabelText('First name')
    await waitFor(() => {
      expect(first).toHaveValue('Ad\u{200B}a')
    })
    const last = screen.getByLabelText('Last name')
    await user.clear(last)
    await user.type(last, 'Lovelace')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(body).toEqual({ lastName: 'Lovelace' })
    })
    expect(
      screen.queryByText('This field contains characters that are not allowed')
    ).not.toBeInTheDocument()
    expect(first).toHaveAttribute('aria-invalid', 'false')
  })

  it('sends only the edited name after a refetch brings a change made elsewhere', async () => {
    let served = { ...testUser, firstName: 'Ada', lastName: 'Byron' }
    useAuthStore.setState({ user: served })
    let body: unknown = null
    server.use(
      http.get('/api/v1/profile', () => ok(served, 'Profile retrieved.')),
      http.patch('/api/v1/profile', async ({ request }) => {
        body = await request.json()
        return ok({ ...served, firstName: 'Augusta' }, 'Profile updated.')
      })
    )
    const user = userEvent.setup()
    renderProfile()

    const first = await screen.findByLabelText('First name')
    await waitFor(() => {
      expect(first).toHaveValue('Ada')
    })
    await user.clear(first)
    await user.type(first, 'Augusta')
    served = { ...served, lastName: 'King\u{200B}' }
    await act(() => queryClient.refetchQueries({ queryKey: profileKeys.detail }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(body).toEqual({ firstName: 'Augusta' })
    })
  })

  it('shows a legacy first name as invalid once the user edits it, and sends nothing', async () => {
    mockLegacyName()
    let called = false
    server.use(
      http.patch('/api/v1/profile', () => {
        called = true
        return ok(testUser, 'Profile updated.')
      })
    )
    const user = userEvent.setup()
    renderProfile()

    const first = await screen.findByLabelText('First name')
    await waitFor(() => {
      expect(first).toHaveValue('Ad\u{200B}a')
    })
    await user.type(first, 'm')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(
      await screen.findByText('This field contains characters that are not allowed')
    ).toBeInTheDocument()
    // The message is the barrier: a refused submit never reaches onSubmit.
    expect(called).toBe(false)
  })

  it('asks for a change, and sends nothing, when Save is pressed with no changes', async () => {
    const toastSuccess = vi.spyOn(toast, 'success')
    let called = false
    server.use(
      http.patch('/api/v1/profile', () => {
        called = true
        return ok(testUser, 'Profile updated.')
      })
    )
    const user = userEvent.setup()
    renderProfile()

    const first = await screen.findByLabelText('First name')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    // The message is the barrier: it is set where the request would have been sent.
    expect(await screen.findByRole('alert')).toHaveTextContent('Change a name before saving.')
    expect(called).toBe(false)
    expect(toastSuccess).not.toHaveBeenCalled()

    await user.type(first, 'b')
    await waitFor(() => {
      expect(screen.queryByText('Change a name before saving.')).not.toBeInTheDocument()
    })
  })

  it('does not send a name changed elsewhere back after an unchanged Save and a refetch', async () => {
    let served = { ...testUser, firstName: 'Ada', lastName: 'Byron' }
    useAuthStore.setState({ user: served })
    let body: unknown = null
    server.use(
      http.get('/api/v1/profile', () => ok(served, 'Profile retrieved.')),
      http.patch('/api/v1/profile', async ({ request }) => {
        body = await request.json()
        return ok({ ...served, firstName: 'Augusta' }, 'Profile updated.')
      })
    )
    const user = userEvent.setup()
    renderProfile()

    const first = await screen.findByLabelText('First name')
    await waitFor(() => {
      expect(first).toHaveValue('Ada')
    })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Change a name before saving.')

    served = { ...served, lastName: 'King', email: 'ada.king@example.com' }
    await act(() => queryClient.refetchQueries({ queryKey: profileKeys.detail }))
    // The email row reads the same query, so it shows the refetch once the form has it too.
    await screen.findByText('ada.king@example.com')
    await user.clear(first)
    await user.type(first, 'Augusta')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(body).toEqual({ firstName: 'Augusta' })
    })
  })

  it('shows a refetch on a form nobody has touched', async () => {
    let served = { ...testUser, firstName: 'Ada', lastName: 'Byron' }
    useAuthStore.setState({ user: served })
    server.use(http.get('/api/v1/profile', () => ok(served, 'Profile retrieved.')))
    renderProfile()

    const last = await screen.findByLabelText('Last name')
    await waitFor(() => {
      expect(last).toHaveValue('Byron')
    })
    served = { ...served, lastName: 'King' }
    await act(() => queryClient.refetchQueries({ queryKey: profileKeys.detail }))

    await waitFor(() => {
      expect(last).toHaveValue('King')
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

    await user.type(await screen.findByLabelText('Last name'), 'x')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
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

    await user.type(await screen.findByLabelText('Last name'), 'x')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

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
