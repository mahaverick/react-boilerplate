import type { AxiosResponse } from 'axios'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiClient, unwrap } from '@/http/client'
import { USER_ID } from '@/tests/fixtures/ids'
import { server } from '@/tests/mocks/server'
import type { ApiSuccess } from '@/types/api.types'

describe('apiClient', () => {
  // Same-origin by design (CLAUDE.md): an absolute origin would bypass the Vite dev proxy, so pin the shape, not just the value.
  it('is configured against a RELATIVE API prefix, never an absolute origin', () => {
    expect(apiClient.defaults.baseURL).toBe('/api/v1')
    expect(apiClient.defaults.baseURL).toMatch(/^\//)
    expect(apiClient.defaults.baseURL).not.toMatch(/^[a-z]+:\/\//i)
  })

  // Same-origin requests carry the cookie regardless; this flag keeps it travelling if the API ever answers from another origin.
  it('sends credentials so the refresh cookie travels', () => {
    expect(apiClient.defaults.withCredentials).toBe(true)
  })

  // Axios has no timeout by default, so a request that is accepted and never answered would leave its mutation pending and its button disabled.
  it('bounds every request with a timeout', () => {
    expect(apiClient.defaults.timeout).toBe(30_000)
  })

  // Asserted on the outgoing config, not by timing out: MSW's XMLHttpRequest interceptor never fires a timeout, so no mocked request can exceed one.
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
      data: { success: true, message: 'OK', statusCode: 200, data: { id: USER_ID } },
    } as AxiosResponse<ApiSuccess<{ id: string }>>
    expect(unwrap(response)).toEqual({ id: USER_ID })
  })
})
