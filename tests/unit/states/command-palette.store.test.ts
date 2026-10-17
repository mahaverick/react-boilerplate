import { beforeEach, describe, expect, it } from 'vitest'
import { useCommandPaletteStore } from '@/states/command-palette.store'

describe('the command palette store', () => {
  beforeEach(() => {
    useCommandPaletteStore.setState({ open: false, query: '' })
  })

  it('clears the query on every close', () => {
    const { setOpen, setQuery, toggle } = useCommandPaletteStore.getState()
    setOpen(true)
    setQuery('acme')
    setOpen(false)
    expect(useCommandPaletteStore.getState()).toMatchObject({ open: false, query: '' })

    toggle()
    setQuery('acme')
    toggle()
    expect(useCommandPaletteStore.getState()).toMatchObject({ open: false, query: '' })
  })

  it('keeps the query while it stays open', () => {
    const { setOpen, setQuery } = useCommandPaletteStore.getState()
    setOpen(true)
    setQuery('acme')
    setOpen(true)
    expect(useCommandPaletteStore.getState().query).toBe('acme')
  })
})
