import type { AxiosAdapter } from 'axios'
import { testUser } from '@/tests/mocks/handlers'

/**
 * A stub axios adapter that answers a session restore as express does:
 * `POST /auth/refresh` with an access token, `GET /profile` with `testUser`.
 * The load-order tests set it on a freshly imported `apiClient`, which the
 * suite's mock server never sees.
 * @returns The adapter.
 */
export function stubSessionAdapter(): AxiosAdapter {
  return (config) => {
    const data = config.url === '/auth/refresh' ? { accessToken: 'fresh-token' } : testUser
    return Promise.resolve({
      data: { success: true, message: 'OK', statusCode: 200, data },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    })
  }
}
