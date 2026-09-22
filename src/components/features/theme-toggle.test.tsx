import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeToggle } from '@/components/features/theme-toggle'
import { useThemeStore } from '@/states/theme.store'

/**
 * The control only. The listener that makes `theme: 'system'` follow a live OS
 * change lives in AppLayout, not here — below `md` this component unmounts
 * with the sidebar — so it is tested in `app-layout.test.tsx`, at both widths.
 */
describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    useThemeStore.setState({ theme: 'system' })
  })

  afterEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  it('names its icon-only trigger, since a Base UI tooltip would not', () => {
    render(<ThemeToggle />)

    // Base UI's Tooltip emits neither role="tooltip" nor aria-describedby, so
    // the only accessible name this control can have is the one it carries.
    expect(screen.getByRole('button', { name: 'Theme: system. Change theme' })).toBeInTheDocument()
  })

  it('applies the theme the user picks from the menu', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)

    await user.click(screen.getByRole('button', { name: 'Theme: system. Change theme' }))
    // Base UI's Menu.Item has no `onSelect` (that is Radix's API), so the
    // items are wired with `onClick`. This is what proves that works.
    await user.click(await screen.findByRole('menuitem', { name: 'Dark' }))

    expect(useThemeStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
