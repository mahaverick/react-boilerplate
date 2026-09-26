import { describe, expect, it } from 'vitest'
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  verifyEmailSchema,
} from '@/schemas/auth.schemas'

describe('auth schemas', () => {
  it('login requires a password but applies no policy to it', () => {
    // Login compares against a stored hash. A policy here would reject a
    // password that was legal when it was set and is not now.
    expect(loginSchema.safeParse({ email: 'a@b.com', password: 'x' }).success).toBe(true)
    expect(loginSchema.safeParse({ email: 'a@b.com', password: '' }).success).toBe(false)
  })

  it('login rejects a malformed email', () => {
    expect(loginSchema.safeParse({ email: 'nope', password: 'secret123' }).success).toBe(false)
  })

  it('register enforces the 8-character minimum', () => {
    const base = { email: 'a@b.com', firstName: 'A', lastName: 'B' }
    expect(registerSchema.safeParse({ ...base, password: 'short7c' }).success).toBe(false)
    expect(registerSchema.safeParse({ ...base, password: 'longenough8' }).success).toBe(true)
  })

  it("register refuses a password past bcrypt's 72-byte ceiling", () => {
    const base = { email: 'a@b.com', firstName: 'A', lastName: 'B' }
    // bcrypt hashes 72 BYTES and ignores the rest, so the backend refuses
    // anything longer rather than silently truncating it.
    expect(registerSchema.safeParse({ ...base, password: 'a'.repeat(72) }).success).toBe(true)
    expect(registerSchema.safeParse({ ...base, password: 'a'.repeat(73) }).success).toBe(false)
    // Counted in bytes, not characters: 18 four-byte emoji are 72 bytes, 19
    // are 76.
    expect(registerSchema.safeParse({ ...base, password: '😀'.repeat(18) }).success).toBe(true)
    expect(registerSchema.safeParse({ ...base, password: '😀'.repeat(19) }).success).toBe(false)
  })

  it('register treats the names as optional, exactly as the backend does', () => {
    const base = { email: 'a@b.com', password: 'longenough8' }
    expect(registerSchema.safeParse(base).success).toBe(true)
    // An empty control means "not given", and is dropped rather than posted
    // as an empty string.
    const parsed = registerSchema.parse({ ...base, firstName: '  ', lastName: '' })
    expect(parsed.firstName).toBeUndefined()
    expect(parsed.lastName).toBeUndefined()
    expect(registerSchema.safeParse({ ...base, firstName: 'A'.repeat(101) }).success).toBe(false)
  })

  it('normalises the email it is given', () => {
    // The transforms only reach the wire if the page parses the value before
    // posting it — see the login page's onSubmit.
    expect(loginSchema.parse({ email: '  ADA@B.COM  ', password: 'x' }).email).toBe('ada@b.com')
  })

  it('verify-email requires BOTH a token and a password', () => {
    expect(verifyEmailSchema.safeParse({ token: 't' }).success).toBe(false)
    expect(verifyEmailSchema.safeParse({ token: 't', password: 'p' }).success).toBe(true)
  })

  it('change-password verifies the current password without a policy', () => {
    // It is compared against the stored hash, like login's.
    const base = { newPassword: 'longenough8', confirmPassword: 'longenough8' }
    expect(changePasswordSchema.safeParse({ ...base, currentPassword: 'x' }).success).toBe(true)
    expect(changePasswordSchema.safeParse({ ...base, currentPassword: '' }).success).toBe(false)
  })

  it('change-password holds the new password to the registration rule', () => {
    const parse = (newPassword: string) =>
      changePasswordSchema.safeParse({
        currentPassword: 'old-password',
        newPassword,
        confirmPassword: newPassword,
      }).success
    expect(parse('short7c')).toBe(false)
    expect(parse('a'.repeat(72))).toBe(true)
    expect(parse('a'.repeat(73))).toBe(false)
  })

  it('change-password flags a mismatched confirmation on that field', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: 'old-password',
      newPassword: 'longenough8',
      confirmPassword: 'different99',
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['confirmPassword'])
    expect(result.error?.issues[0]?.message).toBe('Passwords do not match.')
  })
})

describe('register names: the API safeText rule', () => {
  const base = { email: 'a@b.com', password: 'longenough8' }

  it('rejects a control or bidi character, naming the field the way the API does', () => {
    const result = registerSchema.safeParse({
      ...base,
      firstName: 'a\u{1B}b',
      lastName: 'x\u{202E}',
    })
    expect(result.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      ['firstName', 'First name contains characters that are not allowed'],
      ['lastName', 'Last name contains characters that are not allowed'],
    ])
  })

  it('accepts names in other scripts, with direction marks', () => {
    expect(
      registerSchema.safeParse({ ...base, firstName: 'שָׁלוֹם\u{200F}', lastName: 'Ὀδυσσεύς' })
        .success
    ).toBe(true)
  })
})
