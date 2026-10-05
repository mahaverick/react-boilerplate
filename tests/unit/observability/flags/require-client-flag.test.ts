import { QueryClient } from '@tanstack/react-query'
import { isNotFound } from '@tanstack/react-router'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  BooleanClientFlagKey,
  MultivariateClientFlagKey,
} from '@/observability/flags/flag-types'
import { fallbackFlags } from '@/observability/flags/flag-values'
import { requireClientFlag } from '@/observability/flags/require-client-flag'
import { testFlagKey } from '@/tests/fixtures/test-client-flags'
import { server } from '@/tests/mocks/server'

vi.mock('@/observability/flags/flag-keys', async () => ({
  CLIENT_FLAGS: (await import('@/tests/fixtures/test-client-flags')).TEST_CLIENT_FLAGS,
}))

const BOOL = testFlagKey<BooleanClientFlagKey>('test_bool')
const EXP = testFlagKey<MultivariateClientFlagKey>('test_exp')

/** A variant name typed for any app's slice; an empty slice's variant type is `never`. */
function variant(name: string): never {
  return name as never
}
const NONE = { kind: 'none' } as const

function serveFlags(overrides: Record<string, boolean | string>) {
  server.use(
    http.get('/api/v1/flags', () =>
      HttpResponse.json({
        success: true,
        message: 'Flags retrieved.',
        statusCode: 200,
        data: { flags: { ...fallbackFlags(), ...overrides }, evaluatedAt: 'now' },
      })
    )
  )
}

async function thrown(promise: Promise<void>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  return undefined
}

let queryClient: QueryClient

beforeEach(() => {
  queryClient = new QueryClient()
})

afterEach(() => {
  queryClient.clear()
})

describe('requireClientFlag', () => {
  it('lets the route load while the flag is on', async () => {
    serveFlags({ test_bool: true })
    await expect(requireClientFlag(queryClient, NONE, BOOL)).resolves.toBeUndefined()
  })

  it('throws notFound while the flag is off', async () => {
    serveFlags({ test_bool: false })
    expect(isNotFound(await thrown(requireClientFlag(queryClient, NONE, BOOL)))).toBe(true)
  })

  it('throws notFound when the flags cannot be read', async () => {
    server.use(
      http.get('/api/v1/flags', () =>
        HttpResponse.json({ success: false, message: 'Boom', statusCode: 500 }, { status: 500 })
      )
    )
    expect(isNotFound(await thrown(requireClientFlag(queryClient, NONE, BOOL)))).toBe(true)
  })

  it('compares a multivariate flag with the expected variant', async () => {
    serveFlags({ test_exp: 'bold' })
    await expect(
      requireClientFlag(queryClient, NONE, EXP, variant('bold'))
    ).resolves.toBeUndefined()
    expect(
      isNotFound(await thrown(requireClientFlag(queryClient, NONE, EXP, variant('calm'))))
    ).toBe(true)
  })
})
