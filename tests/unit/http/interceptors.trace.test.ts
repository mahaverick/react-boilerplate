import axios from 'axios'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installInterceptors } from '@/http/interceptors'
import { resetSessionForTests } from '@/http/session'
import * as analytics from '@/observability/analytics'
import { useAuthStore } from '@/states/auth.store'
import { ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/
const SESSION_ID = '01a0fc35-b7fe-7546-a76f-fea28a1f3cbe'

function makeClient() {
  const client = axios.create({ baseURL: '/api/v1', withCredentials: true })
  installInterceptors(client)
  return client
}

/** Answers `url` with the headers it received. */
function echoHeaders(url: string) {
  const seen: Headers[] = []
  server.use(
    http.get(url, ({ request }) => {
      seen.push(request.headers)
      return ok({})
    })
  )
  return seen
}

describe('the trace headers', () => {
  beforeEach(() => {
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: true,
    })
    vi.restoreAllMocks()
  })

  it('send a fresh traceparent on every API request, and no session id while analytics is off', async () => {
    const seen = echoHeaders('/api/v1/widgets')
    const client = makeClient()
    await client.get('/widgets')
    await client.get('/widgets')
    expect(seen[0]?.get('traceparent')).toMatch(TRACEPARENT)
    expect(seen[1]?.get('traceparent')).toMatch(TRACEPARENT)
    expect(seen[0]?.get('traceparent')).not.toBe(seen[1]?.get('traceparent'))
    expect(seen[0]?.has('x-posthog-session-id')).toBe(false)
  })

  it('add the analytics session id when there is one', async () => {
    vi.spyOn(analytics, 'getAnalyticsSessionId').mockReturnValue(SESSION_ID)
    const seen = echoHeaders('/api/v1/widgets')
    await makeClient().get('/widgets')
    expect(seen[0]?.get('x-posthog-session-id')).toBe(SESSION_ID)
  })

  it('keep a traceparent the request already carries', async () => {
    const seen = echoHeaders('/api/v1/widgets')
    const own = `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`
    await makeClient().get('/widgets', { headers: { traceparent: own } })
    expect(seen[0]?.get('traceparent')).toBe(own)
  })

  it('never reach a request that leaves the API', async () => {
    vi.spyOn(analytics, 'getAnalyticsSessionId').mockReturnValue(SESSION_ID)
    const seen: Headers[] = []
    server.use(
      http.get('https://elsewhere.example/thing', ({ request }) => {
        seen.push(request.headers)
        return HttpResponse.json({ success: true, data: {} })
      }),
      http.get('/not-the-api', ({ request }) => {
        seen.push(request.headers)
        return HttpResponse.json({ success: true, data: {} })
      })
    )
    const client = makeClient()
    await client.get('https://elsewhere.example/thing')
    await client.get('/not-the-api', { baseURL: '/' })
    expect(seen).toHaveLength(2)
    for (const headers of seen) {
      expect(headers.has('traceparent')).toBe(false)
      expect(headers.has('x-posthog-session-id')).toBe(false)
    }
  })
})
