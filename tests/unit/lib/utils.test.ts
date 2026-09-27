import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/utils'

describe('cn', () => {
  it('lets the later of two conflicting Tailwind classes win', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('px-2 py-1', 'p-3')).toBe('p-3')
    expect(cn('text-sm', 'text-lg')).toBe('text-lg')
  })

  it('drops falsy values and keeps the keys of an object whose value is true', () => {
    expect(cn('text-sm', false, null, undefined, { 'font-bold': true, italic: false })).toBe(
      'text-sm font-bold'
    )
  })
})
