import { modeFromHeader, stateFromError, stateFromStatus } from '@/lib/maintenance-state'
import { describe, expect, it } from '@/tests/support/runner'
import { MAINTENANCE_MODE, READ_ONLY_MODE } from '@/types/api.types'

describe('modeFromHeader', () => {
  it('an unknown header value changes nothing', () => {
    expect(modeFromHeader('off', 'banana')).toBeNull()
    expect(modeFromHeader('off', undefined)).toBeNull()
    expect(modeFromHeader('full', 42)).toBeNull()
  })

  it('the current mode in the header changes nothing', () => {
    expect(modeFromHeader('full', 'full')).toBeNull()
  })

  it('a known new mode in the header clears the message', () => {
    expect(modeFromHeader('off', 'full')).toBe('full')
    expect(modeFromHeader('full', 'off')).toBe('off')
  })
})

describe('stateFromError', () => {
  it('a 503 body naming read_only wins over the code', () => {
    const state = stateFromError(MAINTENANCE_MODE, { mode: 'read_only', message: 'Soon' })
    expect(state).toEqual({ mode: 'read_only', message: 'Soon', since: null })
    expect(stateFromError(READ_ONLY_MODE, {}).mode).toBe('read_only')
    expect(stateFromError(MAINTENANCE_MODE, null).mode).toBe('full')
  })

  it('a non-string message in a 503 body becomes null', () => {
    expect(stateFromError(MAINTENANCE_MODE, { message: 7, since: {} })).toEqual({
      mode: 'full',
      message: null,
      since: null,
    })
  })
})

describe('stateFromStatus', () => {
  it('drops the message and start time when the mode is off', () => {
    expect(stateFromStatus({ mode: 'off', message: 'x', since: 'y' })).toEqual({
      mode: 'off',
      message: null,
      since: null,
    })
  })
})
