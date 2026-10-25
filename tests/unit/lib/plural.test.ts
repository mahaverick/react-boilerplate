import { describe, expect, it } from 'vite-plus/test'
import { countOf, nounFor } from '@/lib/plural'

describe('countOf', () => {
  it.each([
    [1, 'members', '1 member'],
    [0, 'members', '0 members'],
    [7, 'members', '7 members'],
    [1, 'categories', '1 category'],
    [1, 'boxes', '1 box'],
    [1, 'branches', '1 branch'],
    [1, 'addresses', '1 address'],
    [1, 'houses', '1 house'],
    [1, 'Members', '1 Member'],
    [1, 'staff', '1 staff'],
  ])('writes %s with %s as %s', (count, plural, expected) => {
    expect(countOf(count, plural)).toBe(expected)
  })
})

describe('nounFor', () => {
  it('keeps the plural for any count but one', () => {
    expect(nounFor(3, 'members')).toBe('members')
    expect(nounFor(1, 'members')).toBe('member')
  })
})
