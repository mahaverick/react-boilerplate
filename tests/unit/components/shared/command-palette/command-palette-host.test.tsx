import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** How the app palette's module behaves when the host imports it. */
type PaletteModule = 'loads' | 'fails' | 'fails once' | { gate: Promise<void> }

/**
 * The host and the store it reads, fresh, with the app palette's module
 * replaced: one that renders a marker, one whose load fails as a chunk
 * missing after a deploy would, one that fails once and then loads, or one
 * that waits for a gate. `imports` counts how often the module was requested,
 * and `install` stands in for the recents' identity rule.
 */
async function loadHost(palette: PaletteModule) {
  const imports = { count: 0 }
  const install = vi.fn(() => () => {})
  vi.doMock('@/components/shared/command-palette/recent-items', () => ({
    installRecentItems: install,
  }))
  vi.doMock('@/components/features/command-palette', async () => {
    imports.count += 1
    if (palette === 'fails' || (palette === 'fails once' && imports.count === 1))
      throw new Error('Failed to fetch dynamically imported module')
    if (typeof palette === 'object') await palette.gate
    return { CommandPalette: () => <p>The app palette</p> }
  })
  const host = await import('@/components/shared/command-palette/command-palette-host')
  const loader = await import('@/components/shared/command-palette/palette-loader')
  const { useCommandPaletteStore } = await import('@/states/command-palette.store')
  const { toast } = await import('@/lib/toast')
  return { ...host, ...loader, useCommandPaletteStore, toast, imports, install }
}

describe('CommandPaletteHost', () => {
  beforeEach(() => {
    vi.resetModules()
    // jsdom has no idle callback; the timer fallback is what runs, and no test waits that long.
  })

  afterEach(() => {
    vi.doUnmock('@/components/features/command-palette')
    vi.doUnmock('@/components/shared/command-palette/recent-items')
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('loads the app’s palette on the first open and keeps it mounted after a close', async () => {
    const { CommandPaletteHost, useCommandPaletteStore } = await loadHost('loads')
    render(<CommandPaletteHost />)
    expect(screen.queryByText('The app palette')).not.toBeInTheDocument()

    act(() => useCommandPaletteStore.getState().setOpen(true))
    expect(await screen.findByText('The app palette')).toBeInTheDocument()
    act(() => useCommandPaletteStore.getState().setOpen(false))
    expect(screen.getByText('The app palette')).toBeInTheDocument()
  })

  it('closes and says so when the palette cannot be loaded', async () => {
    const { CommandPaletteHost, PALETTE_LOAD_FAILED, useCommandPaletteStore, toast } =
      await loadHost('fails')
    const error = vi.spyOn(toast, 'error')
    render(<CommandPaletteHost />)
    act(() => useCommandPaletteStore.getState().setOpen(true))
    await waitFor(() => expect(useCommandPaletteStore.getState().open).toBe(false))
    expect(error).toHaveBeenCalledWith(PALETTE_LOAD_FAILED)
  })

  it('fetches again on the next open after a failed load', async () => {
    const { CommandPaletteHost, useCommandPaletteStore, imports } = await loadHost('fails once')
    render(<CommandPaletteHost />)
    act(() => useCommandPaletteStore.getState().setOpen(true))
    await waitFor(() => expect(useCommandPaletteStore.getState().open).toBe(false))
    expect(imports.count).toBe(1)

    act(() => useCommandPaletteStore.getState().setOpen(true))
    expect(await screen.findByText('The app palette')).toBeInTheDocument()
    expect(imports.count).toBe(2)
  })

  it('installs the recents’ identity rule once', async () => {
    const { CommandPaletteHost, useCommandPaletteStore, install } = await loadHost('loads')
    const { rerender } = render(<CommandPaletteHost />)
    act(() => useCommandPaletteStore.getState().setOpen(true))
    await screen.findByText('The app palette')
    rerender(<CommandPaletteHost />)
    expect(install).toHaveBeenCalledTimes(1)
  })

  describe('while the code loads', () => {
    it('says so, politely, and drops the message once the palette is there', async () => {
      let release: (() => void) | undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const { CommandPaletteHost, useCommandPaletteStore } = await loadHost({ gate })
      render(<CommandPaletteHost />)
      expect(screen.queryByText('Loading search…')).not.toBeInTheDocument()

      act(() => useCommandPaletteStore.getState().setOpen(true))
      expect(screen.getByRole('status')).toHaveTextContent('Loading search…')
      expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')

      release?.()
      expect(await screen.findByText('The app palette')).toBeInTheDocument()
      expect(screen.queryByText('Loading search…')).not.toBeInTheDocument()
    })

    it('closes on Escape', async () => {
      const gate = new Promise<void>(() => {})
      const { CommandPaletteHost, useCommandPaletteStore } = await loadHost({ gate })
      render(<CommandPaletteHost />)
      act(() => useCommandPaletteStore.getState().setOpen(true))
      expect(screen.getByRole('status')).toHaveTextContent('Loading search…')
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      })
      expect(useCommandPaletteStore.getState().open).toBe(false)
      expect(screen.queryByText('Loading search…')).not.toBeInTheDocument()
    })
  })

  describe('prefetching', () => {
    it('fetches the palette’s code when the app shell is idle', async () => {
      const idle: (() => void)[] = []
      vi.stubGlobal('requestIdleCallback', (callback: () => void) => idle.push(callback))
      vi.stubGlobal('cancelIdleCallback', () => {})
      const { CommandPaletteHost, imports } = await loadHost('loads')
      render(<CommandPaletteHost />)
      expect(imports.count).toBe(0)

      idle.forEach((callback) => callback())
      await waitFor(() => expect(imports.count).toBe(1))
    })

    it('falls back to a timer where there is no idle callback', async () => {
      vi.useFakeTimers()
      const { CommandPaletteHost, imports } = await loadHost('loads')
      render(<CommandPaletteHost />)
      expect(imports.count).toBe(0)

      await act(() => vi.advanceTimersByTimeAsync(5000))
      expect(imports.count).toBe(1)
    })

    it('fetches on demand for a trigger’s hover or focus, once', async () => {
      const { prefetchPalette, imports } = await loadHost('loads')
      prefetchPalette()
      prefetchPalette()
      await waitFor(() => expect(imports.count).toBe(1))
    })

    it('does not keep a failed prefetch, so a later one tries again', async () => {
      const { prefetchPalette, loadPalette, imports } = await loadHost('fails once')
      prefetchPalette()
      await waitFor(() => expect(imports.count).toBe(1))
      await expect(loadPalette()).resolves.toHaveProperty('CommandPalette')
      expect(imports.count).toBe(2)
    })
  })
})
