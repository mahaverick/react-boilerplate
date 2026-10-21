import { AxiosError } from 'axios'
import { messageFrom } from '@/lib/api-error'
import { isReauthRequired, stepUpRefusal } from '@/lib/step-up'
import { passkeyFailure } from '@/lib/webauthn'
import { track } from '@/observability/telemetry'

const ALREADY_ON_DEVICE =
  'This device already holds a passkey for your account. Use that passkey, or create one on another device.'
const CREATE_FAILED = 'Your browser didn’t create a passkey. Try again, or use another device.'

/**
 * What a failed create tells the person. An API failure shows the server's
 * message (or the step-up refusal); a browser failure is worded here, and a
 * dismissed prompt says nothing but is tracked.
 * @param error - What the create rejected with.
 * @returns The toast text, or null for a dismissed prompt.
 */
export function createFailureMessage(error: unknown): string | null {
  if (error instanceof AxiosError)
    return isReauthRequired(error) ? stepUpRefusal(error) : messageFrom(error)
  const failure = passkeyFailure(error)
  if (failure === 'cancelled') {
    track('passkey_prompt_cancelled', { ceremony: 'create' })
    return null
  }
  return failure === 'already_registered' ? ALREADY_ON_DEVICE : CREATE_FAILED
}
