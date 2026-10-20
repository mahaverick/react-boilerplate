import { messageFrom } from '@/lib/api-error'
import { isReauthRequired, stepUpRefusal } from '@/lib/step-up'

/**
 * The message for a failed write: what a refused step-up means
 * (`stepUpRefusal`, for a `REAUTH_REQUIRED` the "Confirm it's you" dialog could
 * not settle: dismissed, or refused again after confirming), otherwise the
 * server's own message.
 */
export function writeFailureMessage(error: unknown): string {
  return isReauthRequired(error) ? stepUpRefusal(error) : messageFrom(error)
}
