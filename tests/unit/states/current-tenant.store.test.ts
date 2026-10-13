import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readRememberedTenant, useCurrentTenantStore } from '@/states/current-tenant.store'

describe('current tenant store', () => {
  beforeEach(() => {
    localStorage.clear()
    useCurrentTenantStore.setState({ remembered: {} })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('remembers a tenant for a user, across a reload', () => {
    useCurrentTenantStore.getState().remember('user-1', 'acme')
    useCurrentTenantStore.setState({ remembered: {} })
    expect(readRememberedTenant('user-1')).toBe('acme')
  })

  it('keeps one remembered tenant per user', () => {
    useCurrentTenantStore.getState().remember('user-1', 'acme')
    useCurrentTenantStore.getState().remember('user-2', 'globex')
    expect(readRememberedTenant('user-1')).toBe('acme')
    expect(readRememberedTenant('user-2')).toBe('globex')
    expect(readRememberedTenant('user-3')).toBeNull()
  })

  it('works with storage blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => useCurrentTenantStore.getState().remember('user-1', 'acme')).not.toThrow()
    expect(useCurrentTenantStore.getState().remembered['user-1']).toBe('acme')
    expect(readRememberedTenant('user-1')).toBeNull()
  })
})
