import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from '@/states/auth.store'
import type { User } from '@/types/api.types'

const user: User = {
  id: 'u1',
  email: 'a@b.com',
  firstName: 'A',
  lastName: 'B',
  createdAt: '2026-01-01T00:00:00.000Z',
  platformRole: null,
}

describe('auth store', () => {
  beforeEach(() => {
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

  it('setToken replaces the token without touching the user', () => {
    useAuthStore.getState().login('tok', user)
    useAuthStore.getState().setToken('tok2')
    const s = useAuthStore.getState()
    expect(s.accessToken).toBe('tok2')
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
})
