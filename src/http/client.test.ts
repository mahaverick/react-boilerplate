import type { AxiosResponse } from 'axios'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiClient, unwrap } from '@/http/client'
import { server } from '@/tests/mocks/server'
import type { ApiSuccess } from '@/types/api.types'

describe('apiClient', () => {
  // The API ships no CORS middleware and the SPA is served same-origin behind
  // a proxy. An absolute origin here would be blocked by the browser and would
  // bypass the Vite dev proxy, so pin the shape, not just the value.
  it('is configured against a RELATIVE API prefix, never an absolute origin', () => {
    expect(apiClient.defaults.baseURL).toBe('/api/v1')
    expect(apiClient.defaults.baseURL).toMatch(/^\//)
    expect(apiClient.defaults.baseURL).not.toMatch(/^[a-z]+:\/\//i)
  })

  // Without this axios omits the refresh cookie even same-origin, and
  // /auth/refresh has nothing left to authenticate with.
  it('sends credentials so the refresh cookie travels', () => {
    expect(apiClient.defaults.withCredentials).toBe(true)
  })

  // Axios has no timeout by default: a request that is accepted and then never
  // answered hangs forever, leaving its mutation pending and its button
  // disabled with nothing for the user to do.
  it('bounds every request with a timeout', () => {
    expect(apiClient.defaults.timeout).toBe(30_000)
  })

  /**
   * Asserted on the outgoing request config rather than by letting a request
   * actually time out: the timeout is enforced by the XHR/fetch adapter, and
   * MSW's XMLHttpRequest interceptor proxies `ontimeout` without ever firing
   * it, so no mocked request can be made to exceed one. What CAN break here is
   * the default failing to reach an individual request — which is exactly what
   * the adapter reads — so that is what is pinned.
   */
  it('puts that timeout on the requests it actually sends', async () => {
    const seen: (number | undefined)[] = []
    const interceptor = apiClient.interceptors.request.use((config) => {
      seen.push(config.timeout)
      return config
    })
    server.use(http.get('/api/v1/ping', () => new Response('{}')))

    try {
      await apiClient.get('/ping', { skipAuthRetry: true })
    } finally {
      apiClient.interceptors.request.eject(interceptor)
    }

    expect(seen).toEqual([30_000])
  })

  it('unwrap strips the success envelope', () => {
    const response = {
      data: { success: true, message: 'OK', statusCode: 200, data: { id: 'u1' } },
    } as AxiosResponse<ApiSuccess<{ id: string }>>
    expect(unwrap(response)).toEqual({ id: 'u1' })
  })
})
