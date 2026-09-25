import { describe, expect, it } from 'vitest'
import { absoluteTime, relativeTime } from '@/lib/relative-time'

const NOW = Date.parse('2026-09-25T12:00:00.000Z')

describe('relativeTime', () => {
  it('says "just now" inside the first 45 seconds', () => {
    expect(relativeTime('2026-09-25T11:59:30.000Z', NOW)).toBe('just now')
  })

  it('counts minutes, hours and days in the past', () => {
    expect(relativeTime('2026-09-25T11:57:00.000Z', NOW)).toMatch(/3 minutes ago/)
    expect(relativeTime('2026-09-25T10:00:00.000Z', NOW)).toMatch(/2 hours ago/)
    expect(relativeTime('2026-09-24T12:00:00.000Z', NOW)).toMatch(/yesterday|1 day ago/)
  })

  it('does not throw on a value that is not a date', () => {
    expect(relativeTime('not a date', NOW)).toBe('at an unknown time')
  })
})

describe('absoluteTime', () => {
  it('renders a date and a time, and survives a bad value', () => {
    expect(absoluteTime('2026-09-25T12:00:00.000Z')).toMatch(/2026/)
    expect(absoluteTime('not a date')).toBe('Unknown time')
  })
})
