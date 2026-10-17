import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The host and the store it reads, fresh, with the app palette's module
 * replaced: one that renders a marker, or one whose load fails as a chunk
 * missing after a deploy would.
 */
async function loadHost(palette: 'loads' | 'fails') {
  vi.doMock('@/components/features/command-palette', () => {
    if (palette === 'fails') throw new Error('Failed to fetch dynamically imported module')
    return { CommandPalette: () => <p>The app palette</p> }
  })
  const host = await import('@/components/shared/command-palette/command-palette-host')
  const { useCommandPaletteStore } = await import('@/states/command-palette.store')
  const { toast } = await import('@/lib/toast')
  return { ...host, useCommandPaletteStore, toast }
}

describe('CommandPaletteHost', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.doUnmock('@/components/features/command-palette')
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
})
