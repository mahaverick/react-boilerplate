import { afterEach, describe, expect, it, vi } from 'vitest'
import { recordRecent } from '@/components/shared/command-palette/recent-items'
import { clearAllRecents, RECENT_KEY_PREFIX } from '@/components/shared/command-palette/recent-keys'

describe('recent keys', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('names the key the recents module writes under, which sign-out clears by prefix', () => {
    recordRecent('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
      kind: 'tenant',
      id: 't1',
      label: 'Acme Corp',
    })
    expect(Object.keys(localStorage)).toEqual([
      `${RECENT_KEY_PREFIX}aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    ])
    clearAllRecents()
    expect(localStorage.length).toBe(0)
  })

  it('clears every user’s list and nothing else', () => {
    localStorage.setItem(`${RECENT_KEY_PREFIX}one`, '[]')
    localStorage.setItem(`${RECENT_KEY_PREFIX}two`, '[]')
    localStorage.setItem('unrelated', 'kept')
    clearAllRecents()
    expect(Object.keys(localStorage)).toEqual(['unrelated'])
  })

  it('does nothing, and does not throw, when storage is blocked', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => clearAllRecents()).not.toThrow()
  })
})
