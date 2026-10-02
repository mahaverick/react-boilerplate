import { describe, expect, it } from 'vitest'
import { createTraceparent } from '@/http/traceparent'

const FORMAT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/

describe('createTraceparent', () => {
  it('is a W3C traceparent with random ids', () => {
    const first = createTraceparent()
    expect(first).toMatch(FORMAT)
    expect(createTraceparent()).not.toBe(first)
  })

  it('draws again when an id comes out all zeros', () => {
    const draws = [
      new Uint8Array(16),
      new Uint8Array(16).fill(0xab),
      new Uint8Array(8),
      new Uint8Array(8).fill(0x01),
    ]
    const value = createTraceparent((length) => {
      const next = draws.shift()
      if (!next || next.length !== length) throw new Error('unexpected draw')
      return next
    })
    expect(value).toBe(`00-${'ab'.repeat(16)}-${'01'.repeat(8)}-01`)
    expect(draws).toEqual([])
  })
})
