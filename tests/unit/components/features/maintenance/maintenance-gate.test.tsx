import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { resetMaintenanceViewedForTests } from '@/lib/maintenance-mode'
import * as analytics from '@/observability/analytics'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { useMaintenanceModeStore } from '@/states/maintenance-mode.store'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const SINCE = '2026-10-06T10:42:00.000Z'
const LATER = '2026-10-06T12:00:00.000Z'

function renderAppAt(path: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return router
}

/** The status endpoint answering one mode, with the owner's message while on. */
function serveStatus(mode: 'off' | 'read_only' | 'full', since = SINCE) {
  server.use(
    http.get('/api/v1/status/maintenance', () =>
      ok(
        mode === 'off'
          ? { mode, message: null, since: null }
          : { mode, message: 'Upgrading the database.\nBack by 11:00.', since },
        'Maintenance status retrieved.'
      )
    )
  )
}

/** A 503 exactly as express's gate answers it in `full`. */
function fullRefusal() {
  return HttpResponse.json(
    {
      success: false,
      message: 'Upgrading the database.\nBack by 11:00.',
      statusCode: 503,
      code: 'MAINTENANCE_MODE',
      mode: 'full',
      since: SINCE,
      requestId: 'test-request-id',
    },
    { status: 503, headers: { 'Maintenance-Mode': 'full', 'Retry-After': '30' } }
  )
}

function signIn() {
  useAuthStore.setState({
    accessToken: 'access-token',
    user: testUser,
    isAuthenticated: true,
    isBootstrapped: true,
  })
}

const findMaintenancePage = () => screen.findByRole('heading', { name: 'We’ll be back soon' })

beforeEach(() => {
  resetSessionForTests()
  resetMaintenanceViewedForTests()
  window.sessionStorage.clear()
  queryClient.clear()
  useMaintenanceModeStore.setState({ mode: 'off', message: null, since: null })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('full maintenance', () => {
  it('replaces a signed-in page with the message, as text, and the start time', async () => {
    signIn()
    serveStatus('full')
    renderAppAt('/dashboard')

    await findMaintenancePage()
    const main = screen.getByRole('main')
    expect(within(main).getByText(/Upgrading the database\./)).toHaveTextContent(
      'Upgrading the database. Back by 11:00.'
    )
    expect(within(main).getByText(/^Maintenance started /)).toBeInTheDocument()
    expect(within(main).getByText('This page will refresh when we’re back.')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Welcome back/ })).not.toBeInTheDocument()
  })

  it('renders markup in the message as text', async () => {
    signIn()
    server.use(
      http.get('/api/v1/status/maintenance', () =>
        ok({ mode: 'full', message: '<b>bold</b> <img src=x>', since: SINCE }, 'Status.')
      )
    )
    renderAppAt('/dashboard')

    await findMaintenancePage()
    expect(screen.getByText('<b>bold</b> <img src=x>')).toBeInTheDocument()
    expect(document.querySelector('main b, main img')).toBeNull()
  })

  it.each([
    ['sign-in', '/login', 'Sign in'],
    ['sign-up', '/register', 'Create account'],
  ])('replaces the %s page too', async (_name, path, button) => {
    useAuthStore.setState({ isBootstrapped: false })
    server.use(
      http.post('/api/v1/auth/refresh', () =>
        HttpResponse.json(
          { success: false, message: 'Missing refresh token', statusCode: 401, requestId: 'r' },
          { status: 401, headers: { 'Maintenance-Mode': 'full' } }
        )
      )
    )
    serveStatus('full')
    renderAppAt(path)

    await findMaintenancePage()
    expect(screen.queryByRole('button', { name: button })).not.toBeInTheDocument()
  })

  it('stays up, without crashing, while the status endpoint answers an nginx 502', async () => {
    signIn()
    useMaintenanceModeStore.setState({ mode: 'full', message: null, since: null })
    server.use(
      http.get('/api/v1/status/maintenance', () =>
        HttpResponse.text('<html>502 Bad Gateway</html>', {
          status: 502,
          headers: { 'Content-Type': 'text/html' },
        })
      )
    )
    renderAppAt('/dashboard')

    await findMaintenancePage()
    await waitFor(() =>
      expect(queryClient.getQueryState(['maintenance-status'])?.status).toBe('error')
    )
    expect(screen.getByText('We’re carrying out scheduled maintenance.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Something went wrong' })).not.toBeInTheDocument()
  })

  it('returns to the same page, signed in, when the mode ends', async () => {
    signIn()
    serveStatus('full')
    const router = renderAppAt('/profile')
    await findMaintenancePage()

    // The poll's answer, as it lands; the recovery's own refetch reads it too.
    serveStatus('off')
    act(() =>
      useMaintenanceModeStore.getState().setFromStatus({ mode: 'off', message: null, since: null })
    )

    expect(await screen.findByRole('heading', { name: 'Profile', level: 1 })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/profile')
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('keeps the URL of a page loaded during full, and signs the user in when it ends', async () => {
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
    let isFull = true
    server.use(
      http.post('/api/v1/auth/refresh', () =>
        HttpResponse.json(
          {
            success: true,
            message: 'Token refreshed.',
            statusCode: 200,
            data: { accessToken: 't' },
          },
          { headers: { 'Maintenance-Mode': isFull ? 'full' : 'off' } }
        )
      ),
      http.get('/api/v1/profile', () => (isFull ? fullRefusal() : ok(testUser, 'Profile.'))),
      http.get('/api/v1/status/maintenance', () =>
        isFull ? fullRefusal() : ok({ mode: 'off', message: null, since: null }, 'Status.')
      )
    )
    const router = renderAppAt('/profile')

    await findMaintenancePage()
    expect(router.state.location.pathname).toBe('/profile')
    expect(useAuthStore.getState().isAuthenticated).toBe(false)

    isFull = false
    act(() =>
      useMaintenanceModeStore.getState().setFromStatus({ mode: 'off', message: null, since: null })
    )

    expect(await screen.findByRole('heading', { name: 'Profile', level: 1 })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/profile')
    expect(useAuthStore.getState().user).toEqual(testUser)
  })

  it('sends a signed-out visitor to sign in when it ends, as any guarded page does', async () => {
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: true,
    })
    useMaintenanceModeStore.setState({ mode: 'full', message: null, since: null })
    serveStatus('full')
    server.use(http.post('/api/v1/auth/refresh', () => fail('Missing refresh token', 401)))
    const router = renderAppAt('/profile')
    await findMaintenancePage()

    serveStatus('off')
    act(() =>
      useMaintenanceModeStore.getState().setFromStatus({ mode: 'off', message: null, since: null })
    )

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })
})

describe('read-only maintenance', () => {
  it('shows the banner with the message above every page, and no way to dismiss it', async () => {
    signIn()
    serveStatus('read_only')
    renderAppAt('/dashboard')

    const banner = await screen.findByRole('region', { name: 'Maintenance' })
    expect(within(banner).getByText(/changes are paused/)).toBeInTheDocument()
    expect(within(banner).getByText(/Upgrading the database\./)).toBeVisible()
    expect(await screen.findByRole('heading', { name: /Welcome back/ })).toBeInTheDocument()
    expect(within(banner).queryByRole('button', { name: /dismiss|close/i })).toBeNull()
  })

  it('fetches the message when a response header is the first to say read_only', async () => {
    signIn()
    let isOn = false
    server.use(
      http.get('/api/v1/status/maintenance', () =>
        ok(
          isOn
            ? { mode: 'read_only', message: 'Back by 11:00.', since: SINCE }
            : { mode: 'off', message: null, since: null },
          'Maintenance status retrieved.'
        )
      )
    )
    renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })
    await waitFor(() =>
      expect(queryClient.getQueryState(['maintenance-status'])?.status).toBe('success')
    )

    isOn = true
    act(() => useMaintenanceModeStore.getState().setFromHeader('read_only'))

    const banner = await screen.findByRole('region', { name: 'Maintenance' })
    expect(await within(banner).findByText('Back by 11:00.')).toBeVisible()
  })

  it('is not reverted by an older read still in flight when a header says read_only', async () => {
    signIn()
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    server.use(
      http.get('/api/v1/status/maintenance', async () => {
        calls += 1
        if (calls === 1) {
          await held
          return ok({ mode: 'off', message: null, since: null }, 'Maintenance status retrieved.')
        }
        return ok(
          { mode: 'read_only', message: 'Back by 11:00.', since: SINCE },
          'Maintenance status retrieved.'
        )
      })
    )
    renderAppAt('/dashboard')
    await waitFor(() => expect(calls).toBe(1))

    act(() => useMaintenanceModeStore.getState().setFromHeader('read_only'))
    const banner = await screen.findByRole('region', { name: 'Maintenance' })
    expect(await within(banner).findByText('Back by 11:00.')).toBeVisible()

    release()
    await act(() =>
      settle(100, 'the aborted read has no event to observe, only a store it must not reach')
    )
    expect(useMaintenanceModeStore.getState().mode).toBe('read_only')
    expect(screen.getByRole('region', { name: 'Maintenance' })).toBeInTheDocument()
  })

  it('on an app page the read-only banner sits inside main, not above the sidebar shell', async () => {
    signIn()
    serveStatus('read_only')
    renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })
    const banner = await screen.findByRole('region', { name: 'Maintenance' })
    const main = screen.getByRole('main')
    expect(main.contains(banner)).toBe(true)
    expect(banner.previousElementSibling?.tagName).toBe('HEADER')
    expect(screen.getAllByRole('region', { name: 'Maintenance' })).toHaveLength(1)
  })

  it('makes no status read when the header switched read_only on and back off before the read started', async () => {
    signIn()
    let calls = 0
    server.use(
      http.get('/api/v1/status/maintenance', () => {
        calls += 1
        return ok({ mode: 'off', message: null, since: null }, 'Maintenance status retrieved.')
      })
    )
    renderAppAt('/dashboard')
    await waitFor(() =>
      expect(queryClient.getQueryState(['maintenance-status'])?.status).toBe('success')
    )
    const before = calls
    act(() => useMaintenanceModeStore.getState().setFromHeader('read_only'))
    act(() => useMaintenanceModeStore.getState().setFromHeader('off'))
    await act(() => settle(200, 'a read that should not start has no event to wait on'))
    expect(useMaintenanceModeStore.getState().mode).toBe('off')
    expect(calls - before).toBe(0)
  })

  it('drops a status read in flight when a header turns the mode off, so its late answer cannot put read_only back', async () => {
    signIn()
    renderAppAt('/dashboard')
    await waitFor(() =>
      expect(queryClient.getQueryState(['maintenance-status'])?.status).toBe('success')
    )
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    let isAnswered = false
    let isRequested = false
    server.use(
      http.get('/api/v1/status/maintenance', async () => {
        isRequested = true
        await held
        isAnswered = true
        // Served before the switch, delivered after it.
        return HttpResponse.json(
          {
            success: true,
            message: 'Maintenance status retrieved.',
            statusCode: 200,
            data: { mode: 'read_only', message: null, since: SINCE },
          },
          { headers: { 'Maintenance-Mode': 'read_only' } }
        )
      })
    )
    act(() => useMaintenanceModeStore.getState().setFromHeader('read_only'))
    await waitFor(() => expect(isRequested).toBe(true))
    act(() => useMaintenanceModeStore.getState().setFromHeader('off'))
    release()
    await waitFor(() => expect(isAnswered).toBe(true))
    await act(() => settle(200, 'a dropped answer has no event to wait on'))
    expect(useMaintenanceModeStore.getState().mode).toBe('off')
  })

  it('collapses to its summary and expands again', async () => {
    signIn()
    serveStatus('read_only')
    renderAppAt('/dashboard')
    const user = userEvent.setup()

    const banner = await screen.findByRole('region', { name: 'Maintenance' })
    const toggle = within(banner).getByRole('button', { name: 'Hide details' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    await user.click(toggle)
    expect(within(banner).getByRole('button', { name: 'Show details' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(within(banner).getByText(/Upgrading the database\./)).not.toBeVisible()
    expect(within(banner).getByText(/changes are paused/)).toBeVisible()

    await user.click(within(banner).getByRole('button', { name: 'Show details' }))
    expect(within(banner).getByText(/Upgrading the database\./)).toBeVisible()
  })

  it('shows on the sign-in page, which still works', async () => {
    useAuthStore.setState({ isBootstrapped: false })
    server.use(http.post('/api/v1/auth/refresh', () => fail('Missing refresh token', 401)))
    serveStatus('read_only')
    renderAppAt('/login')

    expect(await screen.findByRole('region', { name: 'Maintenance' })).toBeInTheDocument()
    expect(screen.getAllByRole('region', { name: 'Maintenance' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })
})

describe('maintenance_page_viewed', () => {
  it('is sent once per maintenance period, keyed on its start', async () => {
    const track = vi.spyOn(analytics, 'track')
    signIn()
    serveStatus('read_only')
    renderAppAt('/dashboard')
    await screen.findByRole('region', { name: 'Maintenance' })
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('maintenance_page_viewed', { mode: 'read_only' })
    )

    act(() =>
      useMaintenanceModeStore
        .getState()
        .setFromStatus({ mode: 'full', message: 'Upgrading', since: LATER })
    )
    await findMaintenancePage()
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('maintenance_page_viewed', { mode: 'full' })
    )

    // The same period again, as a later poll reports it: not a second event.
    act(() =>
      useMaintenanceModeStore
        .getState()
        .setFromStatus({ mode: 'full', message: 'Upgrading still', since: LATER })
    )
    await screen.findByText('Upgrading still')
    expect(track.mock.calls.filter(([event]) => event === 'maintenance_page_viewed')).toHaveLength(
      2
    )
  })

  it('is not sent while the mode is off', async () => {
    const track = vi.spyOn(analytics, 'track')
    signIn()
    renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })
    await waitFor(() =>
      expect(queryClient.getQueryState(['maintenance-status'])?.status).toBe('success')
    )
    expect(track).not.toHaveBeenCalledWith('maintenance_page_viewed', expect.anything())
  })
})
