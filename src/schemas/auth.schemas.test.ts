import { describe, expect, it } from 'vitest'
import { loginSchema, registerSchema, verifyEmailSchema } from '@/schemas/auth.schemas'

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

  it('verify-email requires BOTH a token and a password', () => {
    expect(verifyEmailSchema.safeParse({ token: 't' }).success).toBe(false)
    expect(verifyEmailSchema.safeParse({ token: 't', password: 'p' }).success).toBe(true)
  })
})
