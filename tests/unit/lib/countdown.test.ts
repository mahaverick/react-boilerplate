import { describe, expect, it } from 'vitest'
import { formatClock, formatMinutesLeft } from '@/lib/countdown'

describe('formatClock', () => {
  it.each([
    [42, '0:42'],
    [65, '1:05'],
    [600, '10:00'],
    [0, '0:00'],
    [-5, '0:00'],
  ])('writes %s seconds as %s', (seconds, expected) => {
    expect(formatClock(seconds)).toBe(expected)
  })
})

describe('formatMinutesLeft', () => {
  it.each([
    [1, '1 min'],
    [240, '4 min'],
    [241, '5 min'],
    [0, '1 min'],
  ])('writes %s seconds as %s', (seconds, expected) => {
    expect(formatMinutesLeft(seconds)).toBe(expected)
  })
})
