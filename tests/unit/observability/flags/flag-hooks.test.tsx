import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as analytics from '@/observability/analytics'
import { resetExposureForTests } from '@/observability/flags/exposure'
import { forgetFeatureProperties } from '@/observability/flags/feature-property-names'
import {
  resetFlagHooksForTests,
  useFeaturePropertiesSync,
  useFlagValues,
  useVariant,
} from '@/observability/flags/flag-hooks'
import type { MultivariateClientFlagKey } from '@/observability/flags/flag-types'
import { fallbackFlags } from '@/observability/flags/flag-values'
import { testFlagKey } from '@/tests/fixtures/test-client-flags'
import { settle } from '@/tests/fixtures/timing'
import { server } from '@/tests/mocks/server'

vi.mock('@/observability/flags/flag-keys', async () => ({
  CLIENT_FLAGS: (await import('@/tests/fixtures/test-client-flags')).TEST_CLIENT_FLAGS,
}))

vi.mock('@/observability/flags/flag-scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/observability/flags/flag-scope')>()),
  useFlagScope: () => ({ kind: 'none' }),
}))

const EXP = testFlagKey<MultivariateClientFlagKey>('test_exp')
const PLAIN = testFlagKey<MultivariateClientFlagKey>('test_plain')

let queryClient: QueryClient
let exposures: string[][]

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

/** Serves `GET /flags` with these values over the fallbacks; `null` never answers. */
function serveFlags(overrides: Record<string, boolean | string> | null) {
  server.use(
    http.get('/api/v1/flags', () =>
      overrides === null
        ? new Promise<Response>(() => {})
        : HttpResponse.json({
            success: true,
            message: 'Flags retrieved.',
            statusCode: 200,
            data: { flags: { ...fallbackFlags(), ...overrides }, evaluatedAt: 'now' },
          })
    )
  )
}

beforeEach(() => {
  queryClient = new QueryClient()
  window.sessionStorage.clear()
  resetExposureForTests()
  resetFlagHooksForTests()
  forgetFeatureProperties()
  exposures = []
  server.use(
    http.post('/api/v1/flags/exposures', async ({ request }) => {
      exposures.push(((await request.json()) as { keys: string[] }).keys)
      return new HttpResponse(null, { status: 204 })
    })
  )
})

afterEach(() => {
  queryClient.clear()
  vi.restoreAllMocks()
  resetExposureForTests()
})

describe('useVariant', () => {
  it('returns the fallback while the flags load', () => {
    serveFlags(null)
    const { result } = renderHook(() => useVariant(EXP), { wrapper })
    expect(result.current).toBe('control')
  })

  it('returns the server value once loaded', async () => {
    serveFlags({ test_exp: 'bold' })
    const { result } = renderHook(() => useVariant(EXP), { wrapper })
    await waitFor(() => expect(result.current).toBe('bold'))
  })

  it('returns the fallback after a failed read', async () => {
    server.use(
      http.get('/api/v1/flags', () =>
        HttpResponse.json({ success: false, message: 'Boom', statusCode: 500 }, { status: 500 })
      )
    )
    const { result } = renderHook(
      () => {
        const values = useFlagValues()
        return { variant: useVariant(EXP), values }
      },
      { wrapper }
    )
    await waitFor(() => expect(queryClient.getQueryState(['flags', 'none'])?.status).toBe('error'))
    expect(result.current.variant).toBe('control')
    expect(result.current.values).toEqual(fallbackFlags())
  })
})

describe('exposure from the hooks', () => {
  it('reports an experiment once its value came from the server', async () => {
    serveFlags({ test_exp: 'bold' })
    renderHook(() => useVariant(EXP), { wrapper })
    await vi.waitFor(() => expect(exposures).toEqual([['test_exp']]))
  })

  it('reports nothing while the value is still the loading fallback', async () => {
    serveFlags(null)
    renderHook(() => useVariant(EXP), { wrapper })
    await settle(200, 'absence has no event: a batch would have been sent by now')
    expect(exposures).toEqual([])
  })

  it('reports nothing for a flag that is not an experiment', async () => {
    serveFlags({ test_plain: 'b' })
    const { result } = renderHook(() => useVariant(PLAIN), { wrapper })
    await waitFor(() => expect(result.current).toBe('b'))
    await settle(200, 'absence has no event: a batch would have been sent by now')
    expect(exposures).toEqual([])
  })

  it('reports once when several components read the same experiment', async () => {
    serveFlags({ test_exp: 'calm' })
    renderHook(() => [useVariant(EXP), useVariant(EXP), useVariant(EXP)], { wrapper })
    await vi.waitFor(() => expect(exposures).toEqual([['test_exp']]))
    await settle(200, 'absence has no event: a second batch would have been sent by now')
    expect(exposures).toHaveLength(1)
  })
})

describe('useFeaturePropertiesSync', () => {
  it('registers every flag as $feature/<key> once the values arrive', async () => {
    const register = vi.spyOn(analytics, 'registerFeatureProperties')
    serveFlags({ test_exp: 'bold', test_bool: true })
    renderHook(() => useFeaturePropertiesSync(), { wrapper })
    await waitFor(() =>
      expect(register).toHaveBeenCalledWith(
        expect.objectContaining({ '$feature/test_exp': 'bold', '$feature/test_bool': true })
      )
    )
  })
})
