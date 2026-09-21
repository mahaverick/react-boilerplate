import { beforeEach, describe, expect, it } from 'vitest'
import { useThemeStore } from '@/states/theme.store'

describe('theme store', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    useThemeStore.setState({ theme: 'system' })
  })

  it('applies the dark class when set to dark', () => {
    useThemeStore.getState().setTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('theme')).toBe('dark')
  })

  it('removes the dark class when set to light', () => {
    useThemeStore.getState().setTheme('dark')
    useThemeStore.getState().setTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('theme')).toBe('light')
  })

  it('follows the OS preference when set to system', () => {
    window.matchMedia = (query: string) => ({
      matches: query.includes('dark'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })

    useThemeStore.getState().setTheme('system')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
