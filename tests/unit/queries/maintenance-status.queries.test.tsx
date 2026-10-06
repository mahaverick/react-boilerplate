import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAINTENANCE_POLL_BASE_MS, MAINTENANCE_POLL_JITTER_MS } from '@/constants/maintenance-mode'
import {
  fetchMaintenanceStatus,
  maintenancePollInterval,
  useMaintenanceStatus,
} from '@/queries/maintenance-status.queries'
import { useMaintenanceModeStore } from '@/states/maintenance-mode.store'
import { ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const SINCE = '2026-10-06T10:42:00.000Z'

/** `maintenancePollInterval` with `Math.random` pinned at 0.5. */
const POLL_MS = MAINTENANCE_POLL_BASE_MS + MAINTENANCE_POLL_JITTER_MS / 2

const ANSWERS = {
  full: () => ok({ mode: 'full', message: 'Upgrading', since: SINCE }, 'Maintenance status.'),
  readOnly: () =>
    ok({ mode: 'read_only', message: 'Back at 11', since: SINCE }, 'Maintenance status.'),
  off: () => ok({ mode: 'off', message: null, since: null }, 'Maintenance status.'),
  // nginx's own page while the API is down mid-deploy.
  badGateway: () =>
    HttpResponse.text('<html>502 Bad Gateway</html>', {
      status: 502,
      headers: { 'Content-Type': 'text/html' },
    }),
  // A 200 that is not JSON: rejectMalformedJsonResponse turns it into a failure.
  notJson: () =>
    HttpResponse.text('<html>maintenance</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    }),
  unknownMode: () => ok({ mode: 'paused', message: null, since: null }, 'Maintenance status.'),
}

/** Answers the status endpoint from `sequence`, repeating its last entry, and counts the calls. */
function serveStatus(...sequence: (keyof typeof ANSWERS)[]) {
  const served = { calls: 0 }
  server.use(
    http.get('/api/v1/status/maintenance', () => {
      const answer = sequence[Math.min(served.calls, sequence.length - 1)] ?? 'off'
      served.calls += 1
      return ANSWERS[answer]()
    })
  )
  return served
}

function mode() {
  return useMaintenanceModeStore.getState().mode
}

describe('maintenancePollInterval', () => {
  it('adds up to the jitter to the base interval', () => {
    expect(maintenancePollInterval(() => 0)).toBe(MAINTENANCE_POLL_BASE_MS)
    expect(maintenancePollInterval(() => 0.5)).toBe(POLL_MS)
    expect(maintenancePollInterval(() => 0.999_999)).toBe(
      MAINTENANCE_POLL_BASE_MS + MAINTENANCE_POLL_JITTER_MS - 1
    )
  })
})

describe('fetchMaintenanceStatus', () => {
  beforeEach(() => {
    useMaintenanceModeStore.setState({ mode: 'off', message: null, since: null })
  })

  it('unwraps the status and applies it to the store', async () => {
    serveStatus('readOnly')
    await expect(fetchMaintenanceStatus()).resolves.toEqual({
      mode: 'read_only',
      message: 'Back at 11',
      since: SINCE,
    })
    expect(useMaintenanceModeStore.getState()).toMatchObject({
      mode: 'read_only',
      message: 'Back at 11',
      since: SINCE,
    })
  })

  it('asks past the browser cache', async () => {
    let cacheControl: string | null = null
    server.use(
      http.get('/api/v1/status/maintenance', ({ request }) => {
        cacheControl = request.headers.get('Cache-Control')
        return ANSWERS.off()
      })
    )
    await fetchMaintenanceStatus()
    expect(cacheControl).toBe('no-cache')
  })

  it('rejects a mode it does not know, and leaves the store alone', async () => {
    useMaintenanceModeStore.setState({ mode: 'full', message: 'Upgrading', since: SINCE })
    serveStatus('unknownMode')
    await expect(fetchMaintenanceStatus()).rejects.toThrow('names no known mode')
    expect(mode()).toBe('full')
  })
})

describe('useMaintenanceStatus', () => {
  let client: QueryClient

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  beforeEach(() => {
    client = new QueryClient()
    useMaintenanceModeStore.setState({ mode: 'off', message: null, since: null })
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    // The query's own interval timer is what these tests are about; nothing else is faked.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    client.clear()
  })

  it('reads the status once at start, and does not poll while the mode is not full', async () => {
    const served = serveStatus('readOnly')
    const { result } = renderHook(() => useMaintenanceStatus(), { wrapper })
    await vi.waitFor(() => expect(mode()).toBe('read_only'))
    expect(served.calls).toBe(1)

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3))
    // The barrier: a refetch of our own. Had the interval fired, this would be a third call.
    await act(() => result.current.refetch())
    expect(served.calls).toBe(2)
  })

  it('polls while full, through a 502 and a body that is not JSON, until the mode ends', async () => {
    const served = serveStatus('full', 'badGateway', 'notJson', 'off')
    const { result } = renderHook(() => useMaintenanceStatus(), { wrapper })
    await vi.waitFor(() => expect(mode()).toBe('full'))

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    await vi.waitFor(() => expect(result.current.isError).toBe(true))
    expect(served.calls).toBe(2)
    expect(mode()).toBe('full')

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    await vi.waitFor(() => expect(served.calls).toBe(3))
    expect(mode()).toBe('full')

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    await vi.waitFor(() => expect(mode()).toBe('off'))
    expect(served.calls).toBe(4)

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3))
    // The barrier again: only this refetch may have called since.
    await act(() => result.current.refetch())
    expect(served.calls).toBe(5)
  })

  it('starts polling when a response header switches the mode to full', async () => {
    const served = serveStatus('off', 'full')
    renderHook(() => useMaintenanceStatus(), { wrapper })
    await vi.waitFor(() => expect(served.calls).toBe(1))

    act(() => useMaintenanceModeStore.getState().setFromHeader('full'))
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    await vi.waitFor(() => expect(served.calls).toBe(2))
    expect(useMaintenanceModeStore.getState()).toMatchObject({ mode: 'full', message: 'Upgrading' })
  })
})
