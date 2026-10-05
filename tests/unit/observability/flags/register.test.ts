import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import * as analytics from '@/observability/analytics'
import type { ClientFlagKey } from '@/observability/flags/flag-types'
import {
  featurePropertyName,
  resetFeaturePropertiesForTests,
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
  resetFeaturePropertiesForTests()
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

  it('unregisters everything for null', () => {
    syncFeatureProperties(values({ test_exp: 'bold' }))
    register.mockClear()
    syncFeatureProperties(null)
    expect(unregister).toHaveBeenCalledWith(['$feature/test_exp'])
    expect(register).not.toHaveBeenCalled()
  })
})
