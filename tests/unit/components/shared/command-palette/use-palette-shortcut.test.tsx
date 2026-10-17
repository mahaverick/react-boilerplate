import { fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePaletteShortcut } from '@/components/shared/command-palette/use-palette-shortcut'
import { useCommandPaletteStore } from '@/states/command-palette.store'

/** Pretends the browser reports `platform`. */
function platform(name: string): void {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(name)
}

describe('usePaletteShortcut', () => {
  beforeEach(() => {
    useCommandPaletteStore.setState({ open: false, query: '' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('toggles on Ctrl+K off Apple platforms', () => {
    platform('Win32')
    renderHook(() => usePaletteShortcut())
    fireEvent.keyDown(window, { code: 'KeyK', key: 'k', ctrlKey: true })
    expect(useCommandPaletteStore.getState().open).toBe(true)
  })

  it('ignores Meta+K off Apple platforms', () => {
    platform('Win32')
    renderHook(() => usePaletteShortcut())
    fireEvent.keyDown(window, { code: 'KeyK', key: 'k', metaKey: true })
    expect(useCommandPaletteStore.getState().open).toBe(false)
  })

  it('toggles on Meta+K on macOS', () => {
    platform('MacIntel')
    renderHook(() => usePaletteShortcut())
    fireEvent.keyDown(window, { code: 'KeyK', key: 'k', metaKey: true })
    expect(useCommandPaletteStore.getState().open).toBe(true)
  })

  it('leaves Ctrl+K alone on macOS, where text fields use it', () => {
    platform('MacIntel')
    renderHook(() => usePaletteShortcut())
    const proceeded = fireEvent.keyDown(window, { code: 'KeyK', key: 'k', ctrlKey: true })
    expect(proceeded).toBe(true)
    expect(useCommandPaletteStore.getState().open).toBe(false)
  })

  it('finds the key by its character on a remapped layout', () => {
    platform('Win32')
    renderHook(() => usePaletteShortcut())
    fireEvent.keyDown(window, { code: 'KeyV', key: 'K', ctrlKey: true })
    expect(useCommandPaletteStore.getState().open).toBe(true)
  })

  it('finds the key by its position on a non-Latin layout', () => {
    platform('Win32')
    renderHook(() => usePaletteShortcut())
    fireEvent.keyDown(window, { code: 'KeyK', key: 'л', ctrlKey: true })
    expect(useCommandPaletteStore.getState().open).toBe(true)
  })

  it('ignores Shift, Alt and other keys', () => {
    platform('Win32')
    renderHook(() => usePaletteShortcut())
    fireEvent.keyDown(window, { code: 'KeyK', key: 'k', ctrlKey: true, shiftKey: true })
    fireEvent.keyDown(window, { code: 'KeyK', key: 'k', ctrlKey: true, altKey: true })
    fireEvent.keyDown(window, { code: 'KeyJ', key: 'j', ctrlKey: true })
    expect(useCommandPaletteStore.getState().open).toBe(false)
  })
})
