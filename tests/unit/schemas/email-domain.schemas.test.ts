import { describe, expect, it } from 'vitest'
import { hostnameDomain } from '@/schemas/email-domain.schemas'

describe('hostnameDomain', () => {
  it('returns the lowercased dotted domain after the last @', () => {
    expect(hostnameDomain('Ada@Example.COM')).toBe('example.com')
    expect(hostnameDomain('a@b@sub.example.com')).toBe('sub.example.com')
  })

  it.each(['a@localhost', 'a@', 'no-at-sign', 'a@-bad.com', 'a@exa mple.com', 'a@b..com'])(
    'returns undefined for %s',
    (email) => {
      expect(hostnameDomain(email)).toBeUndefined()
    }
  )
})
