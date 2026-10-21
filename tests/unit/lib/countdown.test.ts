import { describe, expect, it } from 'vite-plus/test'
import { formatClock, formatTimeLeft } from '@/lib/countdown'

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

describe('formatTimeLeft', () => {
  it.each([
    [1, '1 second'],
    [42, '42 seconds'],
    [59, '59 seconds'],
    [60, '1 min'],
    [61, '2 min'],
    [240, '4 min'],
    [241, '5 min'],
    [0, '1 second'],
  ])('writes %s seconds as %s', (seconds, expected) => {
    expect(formatTimeLeft(seconds)).toBe(expected)
  })
})
