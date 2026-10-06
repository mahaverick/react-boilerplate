import { beforeEach, describe, expect, it } from 'vitest'
import { useMaintenanceModeStore } from '@/states/maintenance-mode.store'

const SINCE = '2026-10-06T10:42:00.000Z'

function state() {
  const { mode, message, since } = useMaintenanceModeStore.getState()
  return { mode, message, since }
}

describe('maintenance mode store', () => {
  beforeEach(() => {
    useMaintenanceModeStore.setState({ mode: 'off', message: null, since: null })
  })

  it('starts off, with nothing known about a message', () => {
    expect(state()).toEqual({ mode: 'off', message: null, since: null })
  })

  it('takes a known mode from the header, dropping the old message and start', () => {
    useMaintenanceModeStore.setState({ mode: 'read_only', message: 'Old', since: SINCE })
    useMaintenanceModeStore.getState().setFromHeader('full')
    expect(state()).toEqual({ mode: 'full', message: null, since: null })
  })

  it('keeps the message when the header repeats the current mode', () => {
    useMaintenanceModeStore.setState({ mode: 'read_only', message: 'Back at 11', since: SINCE })
    useMaintenanceModeStore.getState().setFromHeader('read_only')
    expect(state()).toEqual({ mode: 'read_only', message: 'Back at 11', since: SINCE })
  })

  it.each([undefined, null, '', 'FULL', 'maintenance', 42])(
    'ignores a header of %j, so a response without one never ends maintenance',
    (value) => {
      useMaintenanceModeStore.setState({ mode: 'full', message: 'Upgrading', since: SINCE })
      useMaintenanceModeStore.getState().setFromHeader(value)
      expect(state()).toEqual({ mode: 'full', message: 'Upgrading', since: SINCE })
    }
  )

  it('takes everything from the status endpoint, and clears both texts for off', () => {
    useMaintenanceModeStore
      .getState()
      .setFromStatus({ mode: 'read_only', message: 'Back at 11', since: SINCE })
    expect(state()).toEqual({ mode: 'read_only', message: 'Back at 11', since: SINCE })

    useMaintenanceModeStore
      .getState()
      .setFromStatus({ mode: 'off', message: 'stale', since: SINCE })
    expect(state()).toEqual({ mode: 'off', message: null, since: null })
  })

  it('takes the mode, message and start from a 503 body', () => {
    useMaintenanceModeStore.getState().setFromError('READ_ONLY_MODE', {
      code: 'READ_ONLY_MODE',
      message: 'Back at 11',
      mode: 'read_only',
      since: SINCE,
    })
    expect(state()).toEqual({ mode: 'read_only', message: 'Back at 11', since: SINCE })
  })

  it('derives the mode from the code when the body names none', () => {
    useMaintenanceModeStore.getState().setFromError('MAINTENANCE_MODE', { message: 'Upgrading' })
    expect(state()).toEqual({ mode: 'full', message: 'Upgrading', since: null })

    useMaintenanceModeStore.getState().setFromError('READ_ONLY_MODE', 'not an object')
    expect(state()).toEqual({ mode: 'read_only', message: null, since: null })
  })

  it('never lets a 503 body set the mode to off', () => {
    useMaintenanceModeStore.getState().setFromError('MAINTENANCE_MODE', { mode: 'off' })
    expect(state().mode).toBe('full')
  })
})
