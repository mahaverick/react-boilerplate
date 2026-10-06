import { QueryClient } from '@tanstack/react-query'
import type { AnyRouter } from '@tanstack/react-router'
import axios from 'axios'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAINTENANCE_VIEWED_KEY } from '@/constants/maintenance-mode'
import { installInterceptors } from '@/http/interceptors'
import { resetSessionForTests } from '@/http/session'
import {
  installMaintenanceModeInterceptor,
  installMaintenanceRecovery,
  markMaintenanceViewed,
  resetMaintenanceViewedForTests,
} from '@/lib/maintenance-mode'
import { useAuthStore } from '@/states/auth.store'
import { useMaintenanceModeStore } from '@/states/maintenance-mode.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const SINCE = '2026-10-06T10:42:00.000Z'

function makeClient() {
  const client = axios.create({ baseURL: '/api/v1' })
  installInterceptors(client)
  installMaintenanceModeInterceptor(client)
  return client
}

function mode() {
  return useMaintenanceModeStore.getState().mode
}

/** A 503 exactly as express's gate answers it. */
function maintenanceRefusal(code: 'MAINTENANCE_MODE' | 'READ_ONLY_MODE', header: string) {
  return HttpResponse.json(
    {
      success: false,
      message: 'Back at 11:00.',
      statusCode: 503,
      code,
      mode: code === 'MAINTENANCE_MODE' ? 'full' : 'read_only',
      since: SINCE,
      requestId: 'test-request-id',
    },
    { status: 503, headers: { 'Maintenance-Mode': header, 'Retry-After': '30' } }
  )
}

beforeEach(() => {
  useMaintenanceModeStore.setState({ mode: 'off', message: null, since: null })
})

describe('the maintenance interceptor', () => {
  it('reads the header off a successful response', async () => {
    server.use(
      http.get('/api/v1/widgets', () =>
        HttpResponse.json(
          { success: true, message: 'OK', statusCode: 200, data: [] },
          { headers: { 'Maintenance-Mode': 'read_only' } }
        )
      )
    )
    await makeClient().get('/widgets')
    expect(mode()).toBe('read_only')
  })

  it('reads the header off a failed response, and the failure still rejects as itself', async () => {
    useMaintenanceModeStore.setState({ mode: 'read_only' })
    server.use(
      http.get('/api/v1/widgets', () =>
        HttpResponse.json(
          { success: false, message: 'Nope', statusCode: 404, requestId: 'r' },
          { status: 404, headers: { 'Maintenance-Mode': 'off' } }
        )
      )
    )
    await expect(makeClient().get('/widgets')).rejects.toMatchObject({
      response: { status: 404 },
    })
    expect(mode()).toBe('off')
  })

  it('takes the message and start from a 503 MAINTENANCE_MODE body', async () => {
    server.use(http.get('/api/v1/widgets', () => maintenanceRefusal('MAINTENANCE_MODE', 'full')))
    await expect(makeClient().get('/widgets')).rejects.toMatchObject({
      response: { status: 503 },
    })
    expect(useMaintenanceModeStore.getState()).toMatchObject({
      mode: 'full',
      message: 'Back at 11:00.',
      since: SINCE,
    })
  })

  it('takes read_only from a 503 READ_ONLY_MODE body', async () => {
    server.use(
      http.post('/api/v1/widgets', () => maintenanceRefusal('READ_ONLY_MODE', 'read_only'))
    )
    await expect(makeClient().post('/widgets', {})).rejects.toMatchObject({
      response: { status: 503 },
    })
    expect(useMaintenanceModeStore.getState()).toMatchObject({
      mode: 'read_only',
      message: 'Back at 11:00.',
    })
  })

  it('leaves the mode alone for a 503 that is not maintenance, or an nginx page with no header', async () => {
    useMaintenanceModeStore.setState({ mode: 'full', message: 'Upgrading', since: SINCE })
    server.use(
      http.get('/api/v1/widgets', () =>
        HttpResponse.json(
          { success: false, message: 'Busy', statusCode: 503, requestId: 'r' },
          { status: 503 }
        )
      ),
      http.get('/api/v1/gadgets', () =>
        HttpResponse.text('<html>502 Bad Gateway</html>', {
          status: 502,
          headers: { 'Content-Type': 'text/html' },
        })
      )
    )
    await expect(makeClient().get('/widgets')).rejects.toBeDefined()
    await expect(makeClient().get('/gadgets')).rejects.toBeDefined()
    expect(useMaintenanceModeStore.getState()).toMatchObject({
      mode: 'full',
      message: 'Upgrading',
      since: SINCE,
    })
  })

  it('never signs anyone out on a maintenance 503', async () => {
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    server.use(http.get('/api/v1/widgets', () => maintenanceRefusal('MAINTENANCE_MODE', 'full')))
    await expect(makeClient().get('/widgets')).rejects.toBeDefined()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })
})

describe('recovery when full maintenance ends', () => {
  let uninstall: () => void = () => {}

  beforeEach(() => {
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: true,
    })
  })

  afterEach(() => {
    uninstall()
  })

  function install() {
    const invalidate = vi.fn(() => Promise.resolve())
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    uninstall = installMaintenanceRecovery({ invalidate } as unknown as AnyRouter, queryClient)
    return { invalidate, invalidateQueries }
  }

  it('re-validates the session, then re-runs the guards and refetches, when full ends', async () => {
    const { invalidate, invalidateQueries } = install()
    useMaintenanceModeStore.setState({ mode: 'full' })
    useMaintenanceModeStore.getState().setFromStatus({ mode: 'off', message: null, since: null })

    await vi.waitFor(() => expect(invalidateQueries).toHaveBeenCalled())
    expect(useAuthStore.getState().user).toEqual(testUser)
    expect(invalidate).toHaveBeenCalledOnce()
    expect(Math.max(...invalidate.mock.invocationCallOrder)).toBeLessThan(
      Math.min(...invalidateQueries.mock.invocationCallOrder)
    )
  })

  it('still re-runs the guards when the refresh fails', async () => {
    server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
    const { invalidate } = install()
    useMaintenanceModeStore.setState({ mode: 'full' })
    useMaintenanceModeStore.getState().setFromHeader('read_only')

    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledOnce())
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('recovers only on leaving full, not on entering it or on a new message', async () => {
    const refresh = vi.fn(() => ok({ accessToken: 'fresh-token' }))
    server.use(http.post('/api/v1/auth/refresh', refresh))
    const { invalidate } = install()
    useMaintenanceModeStore.getState().setFromHeader('read_only')
    useMaintenanceModeStore.getState().setFromHeader('full')
    useMaintenanceModeStore.getState().setFromStatus({ mode: 'full', message: 'x', since: SINCE })
    // The barrier: the one change that does leave full.
    useMaintenanceModeStore.getState().setFromStatus({ mode: 'off', message: null, since: null })

    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled())
    expect(invalidate).toHaveBeenCalledOnce()
    expect(refresh).toHaveBeenCalledOnce()
  })
})

describe('markMaintenanceViewed', () => {
  beforeEach(() => {
    resetMaintenanceViewedForTests()
    window.sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('marks each period once', () => {
    expect(markMaintenanceViewed(SINCE)).toBe(true)
    expect(markMaintenanceViewed(SINCE)).toBe(false)
    expect(markMaintenanceViewed('2026-10-06T12:00:00.000Z')).toBe(true)
  })

  it('reads the mark from sessionStorage, so a reload in the same tab does not report again', () => {
    window.sessionStorage.setItem(MAINTENANCE_VIEWED_KEY, SINCE)
    expect(markMaintenanceViewed(SINCE)).toBe(false)
  })

  it('still marks in memory when sessionStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(markMaintenanceViewed(SINCE)).toBe(true)
    expect(markMaintenanceViewed(SINCE)).toBe(false)
  })
})
