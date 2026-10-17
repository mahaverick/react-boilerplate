import { afterEach, describe, expect, it, vi } from 'vitest'
import { isApplePlatform, paletteShortcutHint } from '@/lib/shortcut'

/** Makes `navigator.platform` report `name` until mocks are restored. */
function platform(name: string) {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(name)
}

describe('paletteShortcutHint', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each(['MacIntel', 'iPhone', 'iPad'])('spells it ⌘K on %s', (name) => {
    platform(name)
    expect(isApplePlatform()).toBe(true)
    expect(paletteShortcutHint()).toBe('⌘K')
  })

  it.each(['Win32', 'Linux x86_64', ''])('spells it Ctrl K on %j', (name) => {
    platform(name)
    expect(isApplePlatform()).toBe(false)
    expect(paletteShortcutHint()).toBe('Ctrl K')
  })
})
