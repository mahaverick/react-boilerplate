import { describe, expect, it } from 'vitest'
import { invitationTokenSchema } from '@/schemas/invitation.schemas'
import { TEST_INVITATION_TOKEN } from '@/tests/mocks/handlers'

describe('invitationTokenSchema', () => {
  it('accepts 43 characters of base64url', () => {
    expect(invitationTokenSchema.safeParse(TEST_INVITATION_TOKEN).success).toBe(true)
    expect(invitationTokenSchema.safeParse(`Az09-_${'q'.repeat(37)}`).success).toBe(true)
  })

  it('rejects a truncated or padded token, and the non-url alphabet', () => {
    expect(invitationTokenSchema.safeParse(TEST_INVITATION_TOKEN.slice(1)).success).toBe(false)
    expect(invitationTokenSchema.safeParse(`${TEST_INVITATION_TOKEN}=`).success).toBe(false)
    expect(invitationTokenSchema.safeParse(`+/${'q'.repeat(41)}`).success).toBe(false)
  })
})
