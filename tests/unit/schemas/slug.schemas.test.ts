import { describe, expect, it } from 'vitest'
import { isSlugShaped } from '@/schemas/slug.schemas'

describe('isSlugShaped', () => {
  it.each(['acme', 'a-1', 'platform', 'x'.repeat(100)])('accepts %s', (value) => {
    expect(isSlugShaped(value)).toBe(true)
  })

  it.each(['ab', 'x'.repeat(101), 'Acme', '-acme', 'acme-', ' acme', 'ac me', 'acme\n'])(
    'refuses %j',
    (value) => {
      expect(isSlugShaped(value)).toBe(false)
    }
  )
})
