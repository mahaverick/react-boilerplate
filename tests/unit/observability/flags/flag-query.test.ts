import { QueryClient } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearFlags,
  ensureFlags,
  fetchFlags,
  flagKeyFor,
  flagKeys,
  FLAGS_REFETCH_MS,
  FLAGS_STALE_MS,
  flagScopeId,
  flagsQueryOptions,
} from '@/observability/flags/flag-query'
import { fallbackFlags } from '@/observability/flags/flag-values'
import { server } from '@/tests/mocks/server'

vi.mock('@/observability/flags/flag-keys', async () => ({
  CLIENT_FLAGS: (await import('@/tests/fixtures/test-client-flags')).TEST_CLIENT_FLAGS,
}))

const NONE = { kind: 'none' } as const
const TENANT = { kind: 'tenant', slug: 'acme' } as const
const PLATFORM = { kind: 'platform' } as const

function envelope(flags: unknown) {
  return HttpResponse.json({
    success: true,
    message: 'Flags retrieved.',
    statusCode: 200,
    data: { flags, evaluatedAt: '2026-10-05T09:00:00.000Z' },
  })
}

let queryClient: QueryClient

beforeEach(() => {
  queryClient = new QueryClient()
})

afterEach(() => {
  queryClient.clear()
  vi.restoreAllMocks()
})

describe('keys and scope ids', () => {
  it('keys every scope under flags', () => {
    expect(flagKeyFor(TENANT)).toEqual(['flags', 'tenant', 'acme'])
    expect(flagKeyFor(NONE)).toEqual(['flags', 'none'])
    expect(flagKeyFor(PLATFORM)).toEqual(['flags', 'platform'])
    expect(flagKeys.all).toEqual(['flags'])
  })

  it('names each scope as one string', () => {
    expect(flagScopeId(TENANT)).toBe('tenant:acme')
    expect(flagScopeId(NONE)).toBe('none')
    expect(flagScopeId(PLATFORM)).toBe('platform')
  })
})

describe('flagsQueryOptions', () => {
  it('is fresh for five minutes, refetches every ten and on focus, and never retries', () => {
    const options = flagsQueryOptions(NONE)
    expect(FLAGS_STALE_MS).toBe(300_000)
    expect(FLAGS_REFETCH_MS).toBe(600_000)
    expect(options).toMatchObject({
      staleTime: 300_000,
      refetchInterval: 600_000,
      refetchOnWindowFocus: true,
      retry: false,
    })
  })
})

describe('fetchFlags', () => {
  it('reads the scope path and checks the values', async () => {
    server.use(http.get('/api/v1/flags', () => envelope({ ...fallbackFlags(), test_exp: 'bold' })))
    await expect(fetchFlags(NONE)).resolves.toMatchObject({ test_exp: 'bold', test_bool: false })
  })

  it('rejects an answer without a flags object', async () => {
    server.use(http.get('/api/v1/flags', () => envelope(['not', 'an', 'object'])))
    await expect(fetchFlags(NONE)).rejects.toThrow('no flags object')
  })
})

describe('ensureFlags', () => {
  it('resolves to the server values and caches them', async () => {
    server.use(http.get('/api/v1/flags', () => envelope({ ...fallbackFlags(), test_bool: true })))
    await expect(ensureFlags(queryClient, NONE)).resolves.toMatchObject({ test_bool: true })
    expect(queryClient.getQueryData(flagKeys.none())).toMatchObject({ test_bool: true })
  })

  it('resolves to the fallbacks when the read fails, and never rejects', async () => {
    server.use(
      http.get('/api/v1/flags', () =>
        HttpResponse.json({ success: false, message: 'Boom', statusCode: 500 }, { status: 500 })
      )
    )
    await expect(ensureFlags(queryClient, NONE)).resolves.toEqual(fallbackFlags())
  })

  it('resolves to the fallbacks when the answer is malformed', async () => {
    server.use(http.get('/api/v1/flags', () => envelope(null)))
    await expect(ensureFlags(queryClient, NONE)).resolves.toEqual(fallbackFlags())
  })
})

describe('clearFlags', () => {
  beforeEach(() => {
    queryClient.setQueryData(flagKeys.none(), fallbackFlags())
    queryClient.setQueryData(flagKeys.tenant('acme'), fallbackFlags())
    queryClient.setQueryData(flagKeys.tenant('globex'), fallbackFlags())
    queryClient.setQueryData(['tenants'], [])
  })

  it('removes every scope and nothing else', () => {
    clearFlags(queryClient)
    expect(queryClient.getQueryCache().findAll({ queryKey: flagKeys.all })).toHaveLength(0)
    expect(queryClient.getQueryData(['tenants'])).toEqual([])
  })

  it('keeps the scope it is told to keep', () => {
    clearFlags(queryClient, { keep: { kind: 'tenant', slug: 'globex' } })
    const left = queryClient.getQueryCache().findAll({ queryKey: flagKeys.all })
    expect(left.map((query) => query.queryKey)).toEqual([['flags', 'tenant', 'globex']])
  })
})
