import { QueryClient } from '@tanstack/react-query'
import { AxiosError, AxiosHeaders } from 'axios'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import { listQueryOptions, retryList } from '@/queries/list.queries'
import { listPage } from '@/tests/fixtures/list-page'
import { ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/**
 * An HTTP failure as axios rejects it.
 * @param status - The response status.
 */
function httpError(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() }
  return new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data: { success: false, message: 'No', statusCode: status },
  })
}

describe('retryList', () => {
  it('never retries a refused param or cursor, a refused role, or a 404', () => {
    for (const status of [400, 403, 404]) expect(retryList(0, httpError(status))).toBe(false)
  })

  it('retries anything else once', () => {
    expect(retryList(0, httpError(500))).toBe(true)
    expect(retryList(1, httpError(500))).toBe(false)
  })
})

describe('listQueryOptions', () => {
  it('asks for the total with the first page only, and keys pages by their request', async () => {
    const seen: URLSearchParams[] = []
    server.use(
      http.get('/api/v1/test/rows', ({ request }) => {
        seen.push(new URL(request.url).searchParams)
        return ok(listPage([{ id: 'a' }]), 'Rows retrieved.')
      })
    )
    const client = new QueryClient()
    const first = listQueryOptions({ key: ['rows'], path: '/test/rows', request: { search: 'a' } })
    const later = listQueryOptions({ key: ['rows'], path: '/test/rows', request: { cursor: 'c2' } })

    await client.fetchQuery(first)
    await client.fetchQuery(later)

    expect(seen[0]?.get('total')).toBe('1')
    expect(seen[0]?.get('search')).toBe('a')
    expect(seen[1]?.get('total')).toBeNull()
    expect(first.queryKey).toEqual(['rows', 'list', { search: 'a' }])
  })
})
