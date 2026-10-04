import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  identifyUser,
  resetAnalytics,
  setTenantGroup,
  whenAnalyticsSettled,
  type AnalyticsIdentity,
} from '@/observability/analytics'
import { noteError, resetErrorListenForTests } from '@/observability/errors/listen'
import {
  BATCH_WINDOW_MS,
  resetReporterForTests,
  type ExceptionEvent,
} from '@/observability/errors/report'

vi.mock('@/observability/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/observability/analytics')>()),
  whenAnalyticsSettled: vi.fn(),
  isAnalyticsAvailable: () => true,
  getAnalyticsConfig: () => ({
    key: 'phc_test_key_not_real',
    uiHost: 'https://us.posthog.com',
    consentMode: 'opt_out',
    handoffOrigins: [],
    environment: 'test',
  }),
}))

const AS_USER_A: AnalyticsIdentity = {
  distinctId: 'user-a',
  sessionId: 'session-a',
  windowId: 'window-a',
  groups: { tenant: 'tenant-a' },
}
const fetchMock = vi.fn<typeof fetch>()

function appError(message: string): Error {
  const error = new TypeError(message)
  error.stack = `TypeError: ${message}\n    at render (${location.origin}/assets/index-abc123.js:1:200)`
  return error
}

function sentEvents(): ExceptionEvent[] {
  return fetchMock.mock.calls.flatMap(([, init]) => {
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '') as {
      batch: ExceptionEvent[]
    }
    return body.batch
  })
}

beforeEach(() => {
  resetReporterForTests()
  resetErrorListenForTests()
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(whenAnalyticsSettled).mockResolvedValue(AS_USER_A)
})

afterEach(() => {
  resetReporterForTests()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('an error noted before the reporter loads', () => {
  async function replayAfter(change: () => void): Promise<ExceptionEvent[]> {
    noteError(appError('noted as user A'), 'window', false)
    change()
    // The reporter's chunk loads after the change, well inside the staleness window.
    await vi.waitFor(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    })
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS)
    vi.useRealTimers()
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    return sentEvents()
  }

  it('keeps the identity when nothing changed', async () => {
    const [event] = await replayAfter(() => {})
    expect(event?.distinct_id).toBe('user-a')
  })

  it.each([
    [
      'the user logged out and another logged in',
      () => {
        resetAnalytics()
        identifyUser('user-b')
      },
    ],
    ['the tenant was switched', () => setTenantGroup('tenant-b')],
  ])('is sent anonymous when %s before it loaded', async (_label, change) => {
    const [event] = await replayAfter(change)
    expect(event?.distinct_id).not.toBe('user-a')
    expect(event?.distinct_id).not.toBe('user-b')
    expect(event?.properties.$process_person_profile).toBe(false)
    expect(event?.properties).not.toHaveProperty('$session_id')
    expect(event?.properties).not.toHaveProperty('$groups')
  })
})
