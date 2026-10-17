import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  forgetRecent,
  installRecentItems,
  RECENT_KEY_PREFIX,
  RECENT_LIMIT,
  recordRecent,
  useRecentItems,
} from '@/components/shared/command-palette/recent-items'
import { useAuthStore } from '@/states/auth.store'
import { testUser } from '@/tests/mocks/handlers'

const ALICE = { ...testUser, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
const BOB = { ...testUser, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }

/** The raw stored list for a user, parsed, or null. */
function stored(userId: string): unknown {
  const raw = localStorage.getItem(`${RECENT_KEY_PREFIX}${userId}`)
  return raw === null ? null : JSON.parse(raw)
}

describe('recent items', () => {
  /** The install a test made, undone after it; a no-op when it made none. */
  let uninstall: () => void = () => {}

  beforeEach(() => {
    localStorage.clear()
    useAuthStore.setState({ user: ALICE, isAuthenticated: true })
  })

  afterEach(() => {
    uninstall()
    vi.restoreAllMocks()
  })

  it('keeps the newest first, one per item, at most five of each kind', () => {
    for (let index = 1; index <= RECENT_LIMIT + 2; index += 1) {
      recordRecent(ALICE.id, { kind: 'tenant', id: `t${index}`, label: `Tenant ${index}` })
    }
    recordRecent(ALICE.id, { kind: 'user', id: 'u1', label: 'cleo@example.com' })
    recordRecent(ALICE.id, { kind: 'tenant', id: 't5', label: 'Tenant 5 renamed' })

    const { result } = renderHook(() => useRecentItems())
    expect(result.current.map((entry) => `${entry.kind}:${entry.id}:${entry.label}`)).toEqual([
      'tenant:t5:Tenant 5 renamed',
      'user:u1:cleo@example.com',
      'tenant:t7:Tenant 7',
      'tenant:t6:Tenant 6',
      'tenant:t4:Tenant 4',
      'tenant:t3:Tenant 3',
    ])
  })

  it('stores only the kind, id, label, detail and time', () => {
    recordRecent(ALICE.id, { kind: 'tenant', id: 't1', label: 'Acme Corp', detail: 'acme' })
    const [entry] = stored(ALICE.id) as Record<string, unknown>[]
    expect(Object.keys(entry ?? {}).sort()).toEqual(['at', 'detail', 'id', 'kind', 'label'])
  })

  it('keeps each user’s list under their own key', () => {
    recordRecent(ALICE.id, { kind: 'tenant', id: 't1', label: 'Acme Corp' })
    expect(stored(ALICE.id)).toHaveLength(1)
    expect(stored(BOB.id)).toBeNull()
    useAuthStore.setState({ user: BOB })
    const { result } = renderHook(() => useRecentItems())
    expect(result.current).toEqual([])
  })

  it('forgets one item', () => {
    recordRecent(ALICE.id, { kind: 'tenant', id: 't1', label: 'Acme Corp' })
    recordRecent(ALICE.id, { kind: 'user', id: 't1', label: 'cleo@example.com' })
    forgetRecent(ALICE.id, 'tenant', 't1')
    expect((stored(ALICE.id) as { kind: string }[]).map((entry) => entry.kind)).toEqual(['user'])
  })

  it.each([
    ['malformed JSON', '{not json'],
    ['a non-array', '{"kind":"tenant"}'],
  ])('reads %s as no recents', (_label, raw) => {
    localStorage.setItem(`${RECENT_KEY_PREFIX}${ALICE.id}`, raw)
    const { result } = renderHook(() => useRecentItems())
    expect(result.current).toEqual([])
  })

  it('drops each entry that fails the schema and keeps the rest', () => {
    localStorage.setItem(
      `${RECENT_KEY_PREFIX}${ALICE.id}`,
      JSON.stringify([
        { kind: 'tenant', id: 't1', label: 'Acme Corp', at: 2 },
        { kind: 'email', id: 'e1', label: 'x', at: 3 },
        { kind: 'user', id: '', label: 'blank id', at: 4 },
        { kind: 'user', id: 'u1', label: 'cleo@example.com', at: 'yesterday' },
        { kind: 'user', id: 'u2', label: 'x'.repeat(201), at: 5 },
        { kind: 'user', id: 'u3', label: 'dee@example.com', at: 1, token: 'dropped' },
      ])
    )
    const { result } = renderHook(() => useRecentItems())
    expect(result.current).toEqual([
      { kind: 'tenant', id: 't1', label: 'Acme Corp', at: 2 },
      { kind: 'user', id: 'u3', label: 'dee@example.com', at: 1 },
    ])
  })

  it('keeps working when storage throws on every read and write', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() =>
      recordRecent(ALICE.id, { kind: 'tenant', id: 't1', label: 'Acme Corp' })
    ).not.toThrow()
    const { result } = renderHook(() => useRecentItems())
    expect(result.current).toEqual([])
  })

  it('shows a record made after the reader mounted, and one from another tab', () => {
    const { result } = renderHook(() => useRecentItems())
    act(() => recordRecent(ALICE.id, { kind: 'tenant', id: 't1', label: 'Acme Corp' }))
    expect(result.current.map((entry) => entry.id)).toEqual(['t1'])

    act(() => {
      localStorage.setItem(
        `${RECENT_KEY_PREFIX}${ALICE.id}`,
        JSON.stringify([{ kind: 'tenant', id: 't2', label: 'Globex', at: 9 }])
      )
      window.dispatchEvent(new StorageEvent('storage', { key: `${RECENT_KEY_PREFIX}${ALICE.id}` }))
    })
    expect(result.current.map((entry) => entry.id)).toEqual(['t2'])
  })

  describe('installRecentItems', () => {
    it('deletes the last user’s list on a sign-out', () => {
      uninstall = installRecentItems()
      recordRecent(ALICE.id, { kind: 'tenant', id: 't1', label: 'Acme Corp' })
      useAuthStore.setState({ user: null, isAuthenticated: false })
      expect(stored(ALICE.id)).toBeNull()
    })

    it('deletes the last user’s list when another user signs in', () => {
      uninstall = installRecentItems()
      recordRecent(ALICE.id, { kind: 'tenant', id: 't1', label: 'Acme Corp' })
      useAuthStore.setState({ user: BOB })
      expect(stored(ALICE.id)).toBeNull()
    })

    it('keeps only the signed-in user’s list, on install and on a sign-in', () => {
      recordRecent(ALICE.id, { kind: 'tenant', id: 't1', label: 'Acme Corp' })
      recordRecent(BOB.id, { kind: 'tenant', id: 't2', label: 'Globex' })
      localStorage.setItem('theme', 'dark')
      uninstall = installRecentItems()
      expect(stored(ALICE.id)).toHaveLength(1)
      expect(stored(BOB.id)).toBeNull()
      expect(localStorage.getItem('theme')).toBe('dark')

      useAuthStore.setState({ user: null })
      recordRecent(BOB.id, { kind: 'tenant', id: 't2', label: 'Globex' })
      localStorage.setItem(`${RECENT_KEY_PREFIX}${ALICE.id}`, '[]')
      useAuthStore.setState({ user: BOB })
      expect(stored(ALICE.id)).toBeNull()
      expect(stored(BOB.id)).toHaveLength(1)
    })

    it('installs once, however often it is called', () => {
      const subscribe = vi.spyOn(useAuthStore, 'subscribe')
      uninstall = installRecentItems()
      expect(installRecentItems()).toBe(uninstall)
      expect(subscribe).toHaveBeenCalledTimes(1)
    })

    it('leaves the list alone when the same user is set again', () => {
      uninstall = installRecentItems()
      recordRecent(ALICE.id, { kind: 'tenant', id: 't1', label: 'Acme Corp' })
      useAuthStore.setState({ user: { ...ALICE } })
      expect(stored(ALICE.id)).toHaveLength(1)
    })
  })
})
