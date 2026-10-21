import { describe, expect, it } from 'vitest'
import { passkeyNameSchema } from '@/schemas/passkey.schemas'

describe('passkeyNameSchema', () => {
  it('trims the name', () => {
    expect(passkeyNameSchema.parse('  Work laptop  ')).toBe('Work laptop')
  })

  it('accepts 1 and 64 characters', () => {
    expect(passkeyNameSchema.safeParse('a').success).toBe(true)
    expect(passkeyNameSchema.safeParse('a'.repeat(64)).success).toBe(true)
  })

  it('refuses blank and 65 characters with one message', () => {
    for (const value of ['   ', '', 'a'.repeat(65)]) {
      const result = passkeyNameSchema.safeParse(value)
      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.message).toBe('Enter a name of 1 to 64 characters.')
    }
  })
})
