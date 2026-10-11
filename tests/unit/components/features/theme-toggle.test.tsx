import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeToggle } from '@/components/features/theme-toggle'
import { useThemeStore } from '@/states/theme.store'

/**
 * The control only. The listener that makes `theme: 'system'` follow a live OS
 * change lives in AppLayout, because below `md` this component unmounts with
 * the sidebar; `app-layout.test.tsx` tests it at both widths.
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

    // The trigger is icon-only, and a Base UI Tooltip would add neither role="tooltip" nor aria-describedby, so its own aria-label is its only name.
    expect(screen.getByRole('button', { name: 'Theme: system. Change theme' })).toBeInTheDocument()
  })

  it('applies the theme the user picks from the menu', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)

    await user.click(screen.getByRole('button', { name: 'Theme: system. Change theme' }))
    // Base UI's Menu.Item has no `onSelect` (that is Radix's API), so the items use `onClick`.
    await user.click(await screen.findByRole('menuitem', { name: 'Dark' }))

    expect(useThemeStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
