import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, renderHook, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as analytics from '@/observability/analytics'
import { resetExposureForTests } from '@/observability/flags/exposure'
import { Flag } from '@/observability/flags/flag'
import {
  resetFlagHooksForTests,
  useFeaturePropertiesSync,
  useFlag,
  useFlagValues,
  useVariant,
} from '@/observability/flags/flag-hooks'
import type {
  BooleanClientFlagKey,
  MultivariateClientFlagKey,
} from '@/observability/flags/flag-types'
import { fallbackFlags } from '@/observability/flags/flag-values'
import { forgetFeatureProperties } from '@/observability/flags/register'
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

const BOOL = testFlagKey<BooleanClientFlagKey>('test_bool')
const EXP = testFlagKey<MultivariateClientFlagKey>('test_exp')

/** A variant name typed for any app's slice; an empty slice's variant type is `never`. */
function variant(name: string): never {
  return name as never
}
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

describe('useFlag and useVariant', () => {
  it('return the fallbacks while the flags load', () => {
    serveFlags(null)
    const { result } = renderHook(() => [useFlag(BOOL), useVariant(EXP)] as const, { wrapper })
    expect(result.current).toEqual([false, 'control'])
  })

  it('return the server values once loaded', async () => {
    serveFlags({ test_bool: true, test_exp: 'bold' })
    const { result } = renderHook(() => [useFlag(BOOL), useVariant(EXP)] as const, { wrapper })
    await waitFor(() => expect(result.current).toEqual([true, 'bold']))
  })

  it('return the fallbacks after a failed read', async () => {
    server.use(
      http.get('/api/v1/flags', () =>
        HttpResponse.json({ success: false, message: 'Boom', statusCode: 500 }, { status: 500 })
      )
    )
    const { result } = renderHook(
      () => {
        const values = useFlagValues()
        return { bool: useFlag(BOOL), values }
      },
      { wrapper }
    )
    await waitFor(() => expect(queryClient.getQueryState(['flags', 'none'])?.status).toBe('error'))
    expect(result.current.bool).toBe(false)
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
    serveFlags({ test_plain: 'b', test_bool: true })
    const { result } = renderHook(() => [useVariant(PLAIN), useFlag(BOOL)] as const, {
      wrapper,
    })
    await waitFor(() => expect(result.current).toEqual(['b', true]))
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

describe('<Flag>', () => {
  it('renders nothing while loading, then the children of a flag that is on', async () => {
    serveFlags({ test_bool: true })
    render(<Flag name={BOOL}>Shown</Flag>, { wrapper })
    expect(screen.queryByText('Shown')).not.toBeInTheDocument()
    expect(await screen.findByText('Shown')).toBeInTheDocument()
  })

  it('renders the children of the matching variant only', async () => {
    serveFlags({ test_exp: 'bold' })
    render(
      <>
        <Flag name={EXP} variant={variant('bold')}>
          Bold
        </Flag>
        <Flag name={EXP} variant={variant('calm')}>
          Calm
        </Flag>
      </>,
      { wrapper }
    )
    expect(await screen.findByText('Bold')).toBeInTheDocument()
    expect(screen.queryByText('Calm')).not.toBeInTheDocument()
    await vi.waitFor(() => expect(exposures).toEqual([['test_exp']]))
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
