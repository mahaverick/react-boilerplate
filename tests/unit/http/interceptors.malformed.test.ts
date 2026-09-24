import axios, { AxiosError } from 'axios'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { installInterceptors } from '@/http/interceptors'
import { resetSessionForTests } from '@/http/session'
import { useAuthStore } from '@/states/auth.store'
import { ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { ApiSuccess } from '@/types/api.types'

/**
 * Covers `rejectMalformedJsonResponse`, registered as the SECOND response
 * interceptor. A 2xx whose body is not the JSON object every endpoint
 * promises — an empty string, or an HTML page from a poisoned cache entry or
 * a misrouted proxy — must reject with a request-naming error instead of
 * silently resolving into `unwrap()` returning `undefined`.
 */
function makeClient() {
  const client = axios.create({ baseURL: '/api/v1', withCredentials: true })
  installInterceptors(client)
  return client
}

describe('rejectMalformedJsonResponse', () => {
  // Mirrors interceptors.test.ts's reset so these tests don't depend on
  // auth/session state left over from another file.
  beforeEach(() => {
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
  })

  it('rejects an HTML body served with a 200 (poisoned cache / misrouted response)', async () => {
    server.use(
      http.get('/api/v1/widgets', () =>
        HttpResponse.text('<!doctype html><html><body>SPA shell</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      )
    )

    const error = await makeClient()
      .get('/widgets')
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(AxiosError)
    expect((error as AxiosError).code).toBe('ERR_MALFORMED_RESPONSE')
    expect((error as AxiosError).message).toContain('GET')
    expect((error as AxiosError).message).toContain('/widgets')
  })

  it('rejects a raw (non-JSON-object) string body under a JSON content-type', async () => {
    server.use(
      http.get('/api/v1/widgets', () =>
        HttpResponse.text('not actually json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    )

    const error = await makeClient()
      .get('/widgets')
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(AxiosError)
    expect((error as AxiosError).code).toBe('ERR_MALFORMED_RESPONSE')
  })

  it('passes an empty body with no JSON content-type through untouched (legitimate no-content response)', async () => {
    server.use(
      http.get('/api/v1/widgets', () =>
        HttpResponse.text('', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        })
      )
    )

    const response = await makeClient().get('/widgets')
    expect(response.status).toBe(200)
    expect(response.data).toBe('')
  })

  it('passes a normal JSON object response through untouched', async () => {
    server.use(http.get('/api/v1/widgets', () => ok(['widget'])))

    const response = await makeClient().get<ApiSuccess<string[]>>('/widgets')
    expect(response.data.data).toEqual(['widget'])
  })
})
