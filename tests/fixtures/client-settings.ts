/**
 * @file The client settings the unit tests' default handler answers. Each
 * value differs from express's default (15 minutes, 15 minutes, 3 days,
 * support@ on the sender's domain), so a test passes only when the page
 * renders the answer, never a figure written into the copy.
 */
import type { ClientSettings } from '@/types/api.types'

/** 20 minutes, 25 minutes, 5 days and `support@test.example`. */
export const testClientSettings: ClientSettings = {
  signInLinkTtlSeconds: 20 * 60,
  stepUpLinkTtlSeconds: 25 * 60,
  invitationTtlSeconds: 5 * 86_400,
  supportEmail: 'support@test.example',
}
