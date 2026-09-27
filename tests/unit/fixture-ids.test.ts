import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as ids from '@/tests/fixtures/ids'

describe('fixture ids', () => {
  const entries = Object.entries(ids)

  it('are all UUIDs, as the API validates them', () => {
    expect(entries.length).toBeGreaterThan(0)
    const notUuid = entries.filter(([, value]) => !z.uuid().safeParse(value).success)
    expect(notUuid).toEqual([])
  })

  it('are all distinct', () => {
    const values = entries.map(([, value]) => value)
    expect(new Set(values).size).toBe(values.length)
  })
})
