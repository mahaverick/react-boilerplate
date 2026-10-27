import { describe, expect, it } from 'vite-plus/test'
import { GST_STATES, gstinCheckCharacter, gstinProblem, normaliseGstin, stateOf } from '@/lib/gst'

describe('gstinProblem', () => {
  it.each([
    ['27AAPFU0939F1ZV', null],
    ['29ABCDE1234F1ZW', null],
    ['27ABCDE1234F1Z0', null],
    ['29ABCDE1234F1ZX', 'checksum'],
    ['25ABCDE1234F1Z4', 'state'],
    ['99ABCDE1234F1ZP', 'state'],
    ['29ABCDE1234F1Z', 'shape'],
    ['29ABCDE1234F0ZW', 'shape'],
  ])('gstinProblem(%s) is %s', (gstin, problem) => expect(gstinProblem(gstin)).toBe(problem))
})

describe('gstinCheckCharacter', () => {
  it('computes V for 27AAPFU0939F1Z', () => expect(gstinCheckCharacter('27AAPFU0939F1Z')).toBe('V'))
})

describe('normaliseGstin', () => {
  it('accepts a lower-case GSTIN once normalised', () =>
    expect(gstinProblem(normaliseGstin(' 29abcde1234f1zw '))).toBeNull())
})

describe('GST_STATES', () => {
  it('has 37 states, unique ascending codes, no 25, 28 or 99, and 97 Other Territory', () => {
    const codes = GST_STATES.map((s) => s.code)
    expect(codes).toHaveLength(37)
    expect(new Set(codes).size).toBe(37)
    expect(codes).toEqual([...codes].sort())
    for (const code of codes) expect(code).toMatch(/^[0-9]{2}$/)
    expect(codes).not.toContain('25')
    expect(codes).not.toContain('28')
    expect(codes).not.toContain('99')
    expect(stateOf('97')?.name).toBe('Other Territory')
  })
  it('names 26 and 38 as the contract does', () => {
    expect(stateOf('26')?.name).toBe('Dadra and Nagar Haveli and Daman and Diu')
    expect(stateOf('38')?.name).toBe('Ladakh')
    expect(stateOf('25')).toBeUndefined()
  })
})
