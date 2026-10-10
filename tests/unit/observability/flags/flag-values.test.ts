import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  BooleanClientFlagKey,
  ClientFlagKey,
  ClientFlagValues,
} from '@/observability/flags/flag-types'
import {
  clientFlagFallback,
  clientFlagKeys,
  fallbackFlags,
  filterByFlag,
  isExperimentFlag,
  normalizeFlags,
} from '@/observability/flags/flag-values'
import { testFlagKey } from '@/tests/fixtures/test-client-flags'

vi.mock('@/observability/flags/flag-keys', async () => ({
  CLIENT_FLAGS: (await import('@/tests/fixtures/test-client-flags')).TEST_CLIENT_FLAGS,
}))

const key = (name: string) => testFlagKey<ClientFlagKey>(name)
const values = (record: Record<string, boolean | string>) => record as unknown as ClientFlagValues

afterEach(() => {
  vi.restoreAllMocks()
})

describe('flag definitions', () => {
  it('lists the slice in declaration order', () => {
    expect(clientFlagKeys().slice(0, 3)).toEqual(['test_bool', 'test_exp', 'test_plain'])
  })

  it('gives false or the first variant as the fallback', () => {
    expect(clientFlagFallback(key('test_bool'))).toBe(false)
    expect(clientFlagFallback(key('test_exp'))).toBe('control')
  })

  it('knows which flags are experiments', () => {
    expect(isExperimentFlag(key('test_exp'))).toBe(true)
    expect(isExperimentFlag(key('test_plain'))).toBe(false)
    expect(isExperimentFlag(key('test_bool'))).toBe(false)
    expect(isExperimentFlag(key('not_declared'))).toBe(false)
  })

  it('throws for a key outside the slice', () => {
    expect(() => clientFlagFallback(key('not_declared'))).toThrow('Unknown client flag')
  })

  it('builds every fallback', () => {
    expect(fallbackFlags()).toMatchObject({
      test_bool: false,
      test_exp: 'control',
      test_plain: 'a',
    })
  })
})

describe('normalizeFlags', () => {
  it('keeps valid values', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = normalizeFlags({ ...fallbackFlags(), test_bool: true, test_exp: 'calm' })
    expect(result).toMatchObject({ test_bool: true, test_exp: 'calm', test_plain: 'a' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('fills a missing key with its fallback and warns in development', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const raw: Record<string, unknown> = { ...fallbackFlags(), test_exp: 'bold' }
    delete raw.test_bool
    expect(normalizeFlags(raw)).toMatchObject({ test_bool: false, test_exp: 'bold' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"test_bool"'))
  })

  it('replaces a value of the wrong kind or outside the variants', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = normalizeFlags({ ...fallbackFlags(), test_bool: 'yes', test_exp: 'loud' })
    expect(result).toMatchObject({ test_bool: false, test_exp: 'control' })
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('drops a key the slice does not declare, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = normalizeFlags({ ...fallbackFlags(), server_only: true })
    expect(result).not.toHaveProperty('server_only')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"server_only"'))
  })
})

describe('filterByFlag', () => {
  const items = [
    { label: 'always' },
    { label: 'gated', flag: testFlagKey<BooleanClientFlagKey>('test_bool') },
  ]

  it('hides an item while its flag is off', () => {
    expect(filterByFlag(items, values({ test_bool: false })).map((item) => item.label)).toEqual([
      'always',
    ])
  })

  it('shows it while the flag is on', () => {
    expect(filterByFlag(items, values({ test_bool: true })).map((item) => item.label)).toEqual([
      'always',
      'gated',
    ])
  })
})
