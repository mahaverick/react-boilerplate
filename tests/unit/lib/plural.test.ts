import { describe, expect, it } from 'vite-plus/test'
import { countOf, nounFor } from '@/lib/plural'
import { testPlans } from '@/tests/fixtures/billing'

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

describe('the catalog’s limit labels', () => {
  /** Each limit key's singular, checked by hand; a new limit key fails until it is added here. */
  const SINGULAR: Record<string, string> = { members: 'member' }

  it.each(testPlans.catalog.filter((entry) => entry.kind === 'limit'))(
    'counts $key as a regular plural',
    ({ key, label }) => {
      expect(Object.keys(SINGULAR)).toContain(key)
      expect(countOf(1, label.toLowerCase())).toBe(`1 ${SINGULAR[key] ?? ''}`)
      expect(countOf(2, label.toLowerCase())).toBe(`2 ${label.toLowerCase()}`)
    }
  )
})
