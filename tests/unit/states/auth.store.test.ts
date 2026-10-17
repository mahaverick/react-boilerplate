import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RECENT_KEY_PREFIX } from '@/components/shared/command-palette/recent-keys'
import { useAuthStore } from '@/states/auth.store'
import { USER_ID } from '@/tests/fixtures/ids'
import type { User } from '@/types/api.types'

const user: User = {
  id: USER_ID,
  email: 'a@example.com',
  firstName: 'A',
  lastName: 'B',
  createdAt: '2026-01-01T00:00:00.000Z',
  platformRole: null,
  analyticsOptOut: false,
}

describe('auth store', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
  })

  it('starts unauthenticated and unbootstrapped', () => {
    const s = useAuthStore.getState()
    expect(s.accessToken).toBeNull()
    expect(s.isAuthenticated).toBe(false)
    expect(s.isBootstrapped).toBe(false)
  })

  it('login sets token, user and isAuthenticated together', () => {
    useAuthStore.getState().login('tok', user)
    const s = useAuthStore.getState()
    expect(s.accessToken).toBe('tok')
    expect(s.user).toEqual(user)
    expect(s.isAuthenticated).toBe(true)
  })

  it('logout clears token, user and isAuthenticated but preserves isBootstrapped', () => {
    useAuthStore.getState().login('tok', user)
    useAuthStore.getState().setBootstrapped()
    useAuthStore.getState().logout()
    const s = useAuthStore.getState()
    expect(s.accessToken).toBeNull()
    expect(s.user).toBeNull()
    expect(s.isAuthenticated).toBe(false)
    expect(s.isBootstrapped).toBe(true)
  })

  it('logout removes every stored palette recents list, with no palette loaded', () => {
    localStorage.setItem(`${RECENT_KEY_PREFIX}${USER_ID}`, '[]')
    localStorage.setItem(`${RECENT_KEY_PREFIX}other`, '[]')
    localStorage.setItem('unrelated', 'kept')
    useAuthStore.getState().login('tok', user)
    useAuthStore.getState().logout()
    expect(localStorage.getItem(`${RECENT_KEY_PREFIX}${USER_ID}`)).toBeNull()
    expect(localStorage.getItem(`${RECENT_KEY_PREFIX}other`)).toBeNull()
    expect(localStorage.getItem('unrelated')).toBe('kept')
    localStorage.clear()
  })

  it('logout still ends the session when storage is blocked', () => {
    const blocked = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked')
    })
    try {
      useAuthStore.getState().login('tok', user)
      expect(() => useAuthStore.getState().logout()).not.toThrow()
      expect(useAuthStore.getState().isAuthenticated).toBe(false)
    } finally {
      blocked.mockRestore()
    }
  })
})
