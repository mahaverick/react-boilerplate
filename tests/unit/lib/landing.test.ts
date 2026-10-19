import { describe, expect, it } from 'vitest'
import { safeLanding } from '@/lib/landing'

describe('safeLanding', () => {
  it('keeps a safe same-origin path with its query', () => {
    expect(safeLanding('/notifications?tab=unread')).toBe('/notifications?tab=unread')
  })

  it.each([
    '/auth/link?token=ttt',
    '/auth/link',
    '/Auth/Link/?token=ttt',
    '/invitations/accept?token=ttt',
    '/invitations/accept/',
  ])('refuses the token page %s', (value) => {
    expect(safeLanding(value)).toBeNull()
  })

  it.each(['//evil.test', 'https://evil.test', undefined, null, ''])(
    'refuses what safeRedirect refuses (%s)',
    (value) => {
      expect(safeLanding(value)).toBeNull()
    }
  )
})
