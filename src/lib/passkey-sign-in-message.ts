import { codeFrom } from '@/lib/api-error'
import { retryableFailureMessage } from '@/lib/retry'

/** Sign-in is refused while maintenance mode is full; the API answers 503 `MAINTENANCE_MODE`. */
export const SIGN_IN_PAUSED_MESSAGE =
  'Sign-in is paused for maintenance. Try again when maintenance ends.'

/**
 * What a failed passkey sign-in says. A rate limit names its wait, maintenance
 * uses the sign-in page's line, and any other server answer is shown as it arrives.
 * @param error - What the sign-in rejected with.
 */
export function passkeySignInMessage(error: unknown): string {
  if (codeFrom(error) === 'MAINTENANCE_MODE') return SIGN_IN_PAUSED_MESSAGE
  return retryableFailureMessage(error, 'sign-in attempts')
}
