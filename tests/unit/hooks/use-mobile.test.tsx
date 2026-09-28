import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useIsMobile } from '@/hooks/use-mobile'

const MOBILE_QUERY = '(max-width: 767px)'

describe('useIsMobile', () => {
  let isPhone = false
  let listeners = new Set<() => void>()
  let originalMatchMedia: typeof window.matchMedia

  beforeEach(() => {
    isPhone = false
    listeners = new Set()
    originalMatchMedia = window.matchMedia.bind(window)
    // Answers only the hook's own query, and keeps its listeners so a test can fire a viewport change.
    window.matchMedia = ((query: string) => ({
      get matches() {
        return query === MOBILE_QUERY && isPhone
      },
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_type: string, listener: () => void) => {
        if (query === MOBILE_QUERY) listeners.add(listener)
      },
      removeEventListener: (_type: string, listener: () => void) => {
        listeners.delete(listener)
      },
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
  })

  it('reports a phone on the very first render', () => {
    isPhone = true
    const seen: boolean[] = []
    renderHook(() => {
      const isMobile = useIsMobile()
      seen.push(isMobile)
      return isMobile
    })
    expect(seen[0]).toBe(true)
  })

  it('reports a desktop on the very first render', () => {
    const seen: boolean[] = []
    renderHook(() => {
      const isMobile = useIsMobile()
      seen.push(isMobile)
      return isMobile
    })
    expect(seen).not.toContain(true)
  })

  it('follows a viewport change', () => {
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)

    isPhone = true
    act(() => {
      for (const listener of listeners) listener()
    })
    expect(result.current).toBe(true)
  })

  it('stops listening when unmounted', () => {
    const { unmount } = renderHook(() => useIsMobile())
    expect(listeners.size).toBeGreaterThan(0)
    unmount()
    expect(listeners.size).toBe(0)
  })
})
