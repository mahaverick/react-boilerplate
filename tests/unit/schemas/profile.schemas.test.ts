import { describe, expect, it } from 'vitest'
import { updateProfileSchema } from '@/schemas/profile.schemas'

describe('updateProfileSchema', () => {
  it("rejects a control or bidi character with the API's shared-field message", () => {
    const result = updateProfileSchema.safeParse({
      firstName: 'Ada\u{0}',
      lastName: 'Love\u{202E}',
    })
    expect(result.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      ['firstName', 'This field contains characters that are not allowed'],
      ['lastName', 'This field contains characters that are not allowed'],
    ])
  })

  it('accepts a name in another script', () => {
    expect(updateProfileSchema.safeParse({ firstName: 'محمد', lastName: 'Zoë' }).success).toBe(true)
  })
})
