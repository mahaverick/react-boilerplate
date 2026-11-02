import { describe, expect, it } from 'vite-plus/test'
import { formatExpiry, inDays, inMinutes, linkRules } from '@/lib/link-lifetime'

describe('inMinutes', () => {
  it.each([
    [900, '15 minutes'],
    [1200, '20 minutes'],
    [60, '1 minute'],
    [89, '1 minute'],
    [90, '2 minutes'],
    [10, '1 minute'],
    [7200, '120 minutes'],
  ])('writes %s seconds as %s, rounded as the mail rounds', (seconds, expected) => {
    expect(inMinutes(seconds)).toBe(expected)
  })
})

describe('inDays', () => {
  it.each([
    [259_200, '3 days'],
    [432_000, '5 days'],
    [86_400, '1 day'],
    [86_401, '2 days'],
    [3600, '1 day'],
  ])('writes %s seconds as %s, rounded up as the invitation mail rounds', (seconds, expected) => {
    expect(inDays(seconds)).toBe(expected)
  })
})

describe('linkRules', () => {
  it('states the lifetime when the settings are in', () => {
    expect(linkRules(1200)).toBe('The link works once and expires in 20 minutes.')
  })

  it('states no figure while the settings are loading or failed', () => {
    expect(linkRules(undefined)).toBe('The link works once.')
  })
})

describe('formatExpiry', () => {
  it('writes the date and time with the zone named', () => {
    expect(formatExpiry('2026-11-03T04:45:00.000Z', 'Asia/Kolkata')).toBe(
      '3 November 2026 at 10:15 GMT+5:30'
    )
    expect(formatExpiry('2026-11-03T04:45:00.000Z', 'UTC')).toBe('3 November 2026 at 04:45 UTC')
  })

  it('answers null for no time or one that is not a date', () => {
    expect(formatExpiry(undefined)).toBeNull()
    expect(formatExpiry('soon')).toBeNull()
  })
})
