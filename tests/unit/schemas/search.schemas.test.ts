import { describe, expect, it } from 'vitest'
import { searchText } from '@/schemas/search.schemas'

describe('searchText', () => {
  it('keeps text', () => {
    expect(searchText.parse('acme')).toBe('acme')
  })

  it('takes back a value the router parsed as a number', () => {
    expect(searchText.parse(2026)).toBe('2026')
  })

  it.each([undefined, true, null, { a: 1 }])('treats %j as no search', (value) => {
    expect(searchText.parse(value)).toBeUndefined()
  })
})
