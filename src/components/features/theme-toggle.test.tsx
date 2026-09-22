import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeToggle } from '@/components/features/theme-toggle'
import { useThemeStore } from '@/states/theme.store'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * A `matchMedia` stub whose listeners actually fire.
 *
 * `theme.store.test.ts` has one too, but its `addEventListener` is a no-op —
 * enough to prove the store reads the preference once, useless for proving
 * anything follows a LATER change. This one keeps the listeners and can
 * dispatch to them, which is the whole subject below.
 */
let listeners = new Set<(event: MediaQueryListEvent) => void>()
let prefersDark = false
let originalMatchMedia: typeof window.matchMedia

function installMatchMedia() {
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query === DARK_QUERY ? prefersDark : false
    },
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener)
    },
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

/** The OS colour scheme changes while the tab is open. */
function osSwitchesTo(dark: boolean) {
  prefersDark = dark
  act(() => {
    for (const listener of listeners) listener({ matches: dark } as MediaQueryListEvent)
  })
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    listeners = new Set()
    prefersDark = false
    // Bound, because `@typescript-eslint/unbound-method` rightly objects to
    // lifting a method off its object — and restoring it in afterEach is the
    // only thing this reference is for.
    originalMatchMedia = window.matchMedia.bind(window)
    installMatchMedia()
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  it('names its icon-only trigger, since a Base UI tooltip would not', () => {
    useThemeStore.setState({ theme: 'system' })
    render(<ThemeToggle />)

    // Base UI's Tooltip emits neither role="tooltip" nor aria-describedby, so
    // the only accessible name this control can have is the one it carries.
    expect(screen.getByRole('button', { name: 'Theme: system. Change theme' })).toBeInTheDocument()
  })

  it('follows a live OS change while the theme is system', () => {
    useThemeStore.setState({ theme: 'system' })
    render(<ThemeToggle />)
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    osSwitchesTo(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    osSwitchesTo(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('ignores an OS change once the user has chosen a theme explicitly', () => {
    useThemeStore.setState({ theme: 'light' })
    render(<ThemeToggle />)

    osSwitchesTo(true)
    // The user asked for light. The OS does not get a vote.
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('stops listening once unmounted', () => {
    useThemeStore.setState({ theme: 'system' })
    const { unmount } = render(<ThemeToggle />)
    expect(listeners.size).toBe(1)

    unmount()
    expect(listeners.size).toBe(0)
  })
})
