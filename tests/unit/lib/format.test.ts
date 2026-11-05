import { formatDate, formatDateTime, fullName } from '@/lib/format'
import { describe, expect, it } from '@/tests/support/runner'

// Noon UTC: the same calendar day in every timezone a runner is likely to use.
const NOON_UTC = '2026-03-05T12:00:00.000Z'
const date = new Date(NOON_UTC)

describe('formatDate', () => {
  it('formats in the reader locale, at the style the caller asks for', () => {
    // Expected values come from the options the pages use, so this pins the options without hard-coding one locale's output.
    expect(formatDate(NOON_UTC, 'long')).toBe(
      new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(date)
    )
    expect(formatDate(NOON_UTC, 'medium')).toBe(
      new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
    )
    expect(formatDate(NOON_UTC, 'long')).not.toBe(formatDate(NOON_UTC, 'medium'))
  })

  it('returns null for a value that is not a date, so each caller picks its own fallback', () => {
    expect(formatDate('not a date', 'long')).toBeNull()
  })
})

describe('formatDateTime', () => {
  it('formats a date and a time with the time zone name, in the reader locale', () => {
    const zone = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
      .formatToParts(date)
      .find((part) => part.type === 'timeZoneName')?.value
    expect(zone).toBeTruthy()
    expect(formatDateTime(NOON_UTC)).toContain(zone)
    expect(formatDateTime(NOON_UTC)).toContain(String(date.getFullYear()))
  })

  it('returns null for a value that is not a date', () => {
    expect(formatDateTime('')).toBeNull()
  })
})

describe('fullName', () => {
  it('joins the parts that have text', () => {
    expect(fullName({ firstName: 'Ada', lastName: 'Lovelace' })).toBe('Ada Lovelace')
    expect(fullName({ firstName: 'Ada', lastName: null })).toBe('Ada')
    expect(fullName({ firstName: null, lastName: 'Lovelace' })).toBe('Lovelace')
  })

  it('trims each part before joining', () => {
    expect(fullName({ firstName: ' Ada ', lastName: ' Lovelace ' })).toBe('Ada Lovelace')
  })

  it('returns null when neither part has text', () => {
    expect(fullName({ firstName: '  ', lastName: '' })).toBeNull()
    expect(fullName({ firstName: null, lastName: null })).toBeNull()
    expect(fullName(null)).toBeNull()
    expect(fullName(undefined)).toBeNull()
  })
})
