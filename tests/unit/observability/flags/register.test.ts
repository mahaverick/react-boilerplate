import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import * as analytics from '@/observability/analytics'
import type { ClientFlagKey } from '@/observability/flags/flag-types'
import {
  featurePropertyName,
  forgetFeatureProperties,
  syncFeatureProperties,
} from '@/observability/flags/register'
import { testFlagKey } from '@/tests/fixtures/test-client-flags'

vi.mock('@/observability/flags/flag-keys', async () => ({
  CLIENT_FLAGS: (await import('@/tests/fixtures/test-client-flags')).TEST_CLIENT_FLAGS,
}))

/** Test-slice values, typed for any app's slice. */
function values(record: Record<string, boolean | string>) {
  return record as unknown as Parameters<typeof syncFeatureProperties>[0]
}

let register: MockInstance<typeof analytics.registerFeatureProperties>
let unregister: MockInstance<typeof analytics.unregisterFeatureProperties>

beforeEach(() => {
  forgetFeatureProperties()
  register = vi.spyOn(analytics, 'registerFeatureProperties').mockImplementation(() => undefined)
  unregister = vi
    .spyOn(analytics, 'unregisterFeatureProperties')
    .mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('syncFeatureProperties', () => {
  it('names the property $feature/<key>', () => {
    expect(featurePropertyName(testFlagKey<ClientFlagKey>('test_exp'))).toBe('$feature/test_exp')
  })

  it('registers each value present', () => {
    syncFeatureProperties(values({ test_bool: true, test_exp: 'bold' }))
    expect(register).toHaveBeenCalledWith({
      '$feature/test_bool': true,
      '$feature/test_exp': 'bold',
    })
    expect(unregister).not.toHaveBeenCalled()
  })

  it('unregisters a key it registered before and no longer has', () => {
    syncFeatureProperties(values({ test_bool: true, test_exp: 'bold' }))
    syncFeatureProperties(values({ test_exp: 'calm' }))
    expect(unregister).toHaveBeenCalledWith(['$feature/test_bool'])
    expect(register).toHaveBeenLastCalledWith({ '$feature/test_exp': 'calm' })
  })

  it('after forgetting, registers afresh and unregisters nothing', () => {
    syncFeatureProperties(values({ test_bool: true, test_exp: 'bold' }))
    forgetFeatureProperties()
    register.mockClear()
    syncFeatureProperties(values({ test_exp: 'calm' }))
    expect(unregister).not.toHaveBeenCalled()
    expect(register).toHaveBeenCalledWith({ '$feature/test_exp': 'calm' })
  })

  it('skips a sync whose values are exactly those registered', () => {
    syncFeatureProperties(values({ test_bool: true, test_exp: 'bold' }))
    register.mockClear()
    syncFeatureProperties(values({ test_exp: 'bold', test_bool: true }))
    syncFeatureProperties(null)
    syncFeatureProperties(null)
    expect(register).not.toHaveBeenCalled()
    expect(unregister).toHaveBeenCalledTimes(1)
  })

  it('registers again when a value changes under the same names', () => {
    syncFeatureProperties(values({ test_exp: 'bold' }))
    syncFeatureProperties(values({ test_exp: 'calm' }))
    expect(register).toHaveBeenLastCalledWith({ '$feature/test_exp': 'calm' })
    expect(unregister).not.toHaveBeenCalled()
  })

  it('unregisters everything for null', () => {
    syncFeatureProperties(values({ test_exp: 'bold' }))
    register.mockClear()
    syncFeatureProperties(null)
    expect(unregister).toHaveBeenCalledWith(['$feature/test_exp'])
    expect(register).not.toHaveBeenCalled()
  })
})
