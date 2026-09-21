import type { AxiosResponse } from 'axios'
import { describe, expect, it } from 'vitest'
import { apiClient, unwrap } from '@/http/client'
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

  it('unwrap strips the success envelope', () => {
    const response = {
      data: { success: true, message: 'OK', statusCode: 200, data: { id: 'u1' } },
    } as AxiosResponse<ApiSuccess<{ id: string }>>
    expect(unwrap(response)).toEqual({ id: 'u1' })
  })
})
