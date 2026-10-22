import { describe, expect, it } from 'vite-plus/test'
import { emailSchema, signInLinkRequestSchema } from '@/schemas/auth.schemas'

describe('emailSchema', () => {
  it('normalises the email it is given', () => {
    // The transforms reach the wire only if the page parses the value before posting it, as the sign-in form does.
    expect(emailSchema.parse('  ADA@EXAMPLE.COM  ')).toBe('ada@example.com')
  })

  it('refuses an address longer than the API allows', () => {
    const local = 'a'.repeat(64)
    const domain = `${'b'.repeat(250)}.test`
    // 64 + 1 + 255 = 320 characters, the API's ceiling; one more is refused.
    expect(emailSchema.safeParse(`${local}@${domain}`).success).toBe(true)
    expect(emailSchema.safeParse(`${local}a@${domain}`).success).toBe(false)
  })
})

describe('signInLinkRequestSchema', () => {
  it('lowercases and trims the sign-in email', () => {
    expect(signInLinkRequestSchema.parse({ email: '  Ada@Example.COM ' })).toEqual({
      email: 'ada@example.com',
    })
  })

  it('refuses a malformed email', () => {
    expect(signInLinkRequestSchema.safeParse({ email: 'nope' }).success).toBe(false)
  })
})
