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
  it('never retries a 4xx other than a timeout or a rate limit', () => {
    for (const status of [400, 401, 403, 404, 409, 422])
      expect(retryList(0, httpError(status))).toBe(false)
  })

  it('retries a timeout or a rate limit once', () => {
    for (const status of [408, 429]) {
      expect(retryList(0, httpError(status))).toBe(true)
      expect(retryList(1, httpError(status))).toBe(false)
    }
  })

  it('retries anything else once', () => {
    expect(retryList(0, httpError(500))).toBe(true)
    expect(retryList(1, httpError(500))).toBe(false)
  })
})

describe('listQueryOptions', () => {
  it('keys a page without a total apart from the same request with one', () => {
    const request = { limit: 5 }
    const withTotal = listQueryOptions({ key: ['rows'], path: '/test/rows', request })
    const without = listQueryOptions({ key: ['rows'], path: '/test/rows', request, total: false })

    expect(without.queryKey).not.toEqual(withTotal.queryKey)
    expect(withTotal.queryKey).toEqual(['rows', 'list', request])
  })

  it('leaves the total out of a first page when asked not to read it', async () => {
    const seen: URLSearchParams[] = []
    server.use(
      http.get('/api/v1/test/rows', ({ request }) => {
        seen.push(new URL(request.url).searchParams)
        return ok(listPage([{ id: 'a' }]), 'Rows retrieved.')
      })
    )
    const client = new QueryClient()

    await client.fetchQuery(
      listQueryOptions({ key: ['rows'], path: '/test/rows', request: { limit: 5 }, total: false })
    )

    expect(seen[0]?.get('limit')).toBe('5')
    expect(seen[0]?.has('total')).toBe(false)
  })

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
