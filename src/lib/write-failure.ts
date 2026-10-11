import { codeFrom, messageFrom } from '@/lib/api-error'
import { REAUTH_REQUIRED } from '@/types/api.types'

/**
 * What a refused stale step-up says. This app has no step-up flow, so the only
 * way to a fresh sign-in is to sign out and back in.
 */
export const SIGN_IN_AGAIN =
  'For your security, sign out and sign in again before making this change.'

/**
 * The message for a failed write: the prompt to sign in again when the API
 * refused with `REAUTH_REQUIRED` (a sign-in too old for a staff write on the
 * platform tenant's members or invitations), otherwise the server's own message.
 */
export function writeFailureMessage(error: unknown): string {
  return codeFrom(error) === REAUTH_REQUIRED ? SIGN_IN_AGAIN : messageFrom(error)
}
