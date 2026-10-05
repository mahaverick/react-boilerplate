import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearExposureDedupe,
  EXPOSURE_BATCH_MS,
  EXPOSURE_DEDUPE_PREFIX,
  MAX_EXPOSURE_KEYS,
  reportExposure,
  resetExposureForTests,
} from '@/observability/flags/exposure'
import type { ClientFlagKey } from '@/observability/flags/flag-types'
import { testFlagKey } from '@/tests/fixtures/test-client-flags'
import { settle } from '@/tests/fixtures/timing'
import { server } from '@/tests/mocks/server'

vi.mock('@/observability/flags/flag-keys', async () => ({
  CLIENT_FLAGS: (await import('@/tests/fixtures/test-client-flags')).TEST_CLIENT_FLAGS,
}))

const key = (name: string) => testFlagKey<ClientFlagKey>(name)
const NONE = { kind: 'none' } as const
const TENANT = { kind: 'tenant', slug: 'acme' } as const

/** Each exposure POST as `path keys…`, in arrival order. */
let posts: { path: string; keys: string[] }[]

beforeEach(() => {
  resetExposureForTests()
  window.sessionStorage.clear()
  posts = []
  server.use(
    http.post('*/flags/exposures', async ({ request }) => {
      const body = (await request.json()) as { keys: string[] }
      posts.push({ path: new URL(request.url).pathname, keys: body.keys })
      return new HttpResponse(null, { status: 204 })
    })
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  resetExposureForTests()
})

describe('reportExposure', () => {
  it('batches reports in one window into one POST per scope', async () => {
    reportExposure(NONE, key('test_exp'), 'bold')
    reportExposure(NONE, key('test_exp_01'), 'control')
    reportExposure(TENANT, key('test_exp'), 'calm')
    expect(EXPOSURE_BATCH_MS).toBe(50)
    await vi.waitFor(() => expect(posts).toHaveLength(2))
    expect(posts).toEqual([
      { path: '/api/v1/flags/exposures', keys: ['test_exp', 'test_exp_01'] },
      { path: '/api/v1/tenants/acme/flags/exposures', keys: ['test_exp'] },
    ])
  })

  it('reports a scope, key and value once per tab session', async () => {
    reportExposure(NONE, key('test_exp'), 'bold')
    await vi.waitFor(() => expect(posts).toHaveLength(1))
    reportExposure(NONE, key('test_exp'), 'bold')
    await settle(EXPOSURE_BATCH_MS * 4, 'absence has no event: a second batch would be due by now')
    expect(posts).toHaveLength(1)
    expect(window.sessionStorage.getItem(`${EXPOSURE_DEDUPE_PREFIX}none:test_exp:bold`)).toBe('1')
  })

  it('reports again when the value changes', async () => {
    reportExposure(NONE, key('test_exp'), 'bold')
    await vi.waitFor(() => expect(posts).toHaveLength(1))
    reportExposure(NONE, key('test_exp'), 'calm')
    await vi.waitFor(() => expect(posts).toHaveLength(2))
  })

  it('reads the dedupe from sessionStorage, so a reload in the same tab does not report again', async () => {
    window.sessionStorage.setItem(`${EXPOSURE_DEDUPE_PREFIX}none:test_exp:bold`, '1')
    reportExposure(NONE, key('test_exp'), 'bold')
    await settle(EXPOSURE_BATCH_MS * 4, 'absence has no event: the batch would be due by now')
    expect(posts).toHaveLength(0)
  })

  it(`splits a batch into POSTs of at most ${MAX_EXPOSURE_KEYS} keys`, async () => {
    for (let index = 1; index <= 12; index += 1) {
      reportExposure(NONE, key(`test_exp_${String(index).padStart(2, '0')}`), 'control')
    }
    await vi.waitFor(() => expect(posts).toHaveLength(2))
    expect(posts.map((post) => post.keys.length)).toEqual([10, 2])
  })

  it('swallows a failed POST and never retries it', async () => {
    server.use(
      http.post('*/flags/exposures', ({ request }) => {
        posts.push({ path: new URL(request.url).pathname, keys: [] })
        return HttpResponse.json(
          { success: false, message: 'Busy', statusCode: 429 },
          { status: 429 }
        )
      })
    )
    reportExposure(NONE, key('test_exp'), 'bold')
    await vi.waitFor(() => expect(posts).toHaveLength(1))
    reportExposure(NONE, key('test_exp'), 'bold')
    await settle(EXPOSURE_BATCH_MS * 4, 'absence has no event: a retry would be due by now')
    expect(posts).toHaveLength(1)
  })

  it('still dedupes in memory when sessionStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    reportExposure(NONE, key('test_exp'), 'bold')
    reportExposure(NONE, key('test_exp'), 'bold')
    await vi.waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]?.keys).toEqual(['test_exp'])
  })
})

describe('clearExposureDedupe', () => {
  it('forgets every mark, so the next person reports afresh', async () => {
    window.sessionStorage.setItem('unrelated', 'kept')
    reportExposure(NONE, key('test_exp'), 'bold')
    await vi.waitFor(() => expect(posts).toHaveLength(1))
    clearExposureDedupe()
    expect(window.sessionStorage.getItem(`${EXPOSURE_DEDUPE_PREFIX}none:test_exp:bold`)).toBeNull()
    expect(window.sessionStorage.getItem('unrelated')).toBe('kept')
    reportExposure(NONE, key('test_exp'), 'bold')
    await vi.waitFor(() => expect(posts).toHaveLength(2))
  })
})
