/**
 * @file Step-up support outside React: recognising the API's `REAUTH_REQUIRED`
 * 401, telling whether a refusal is already out of date because a fresher
 * token has landed since the request went out, the emailed link's timings,
 * and reading whether a refresh brought a new confirmation.
 */
import axios from 'axios'
import { codeFrom, statusFrom } from '@/lib/api-error'
import { useAuthStore } from '@/states/auth.store'
import { REAUTH_REQUIRED } from '@/types/api.types'

/** Whether a failed request was refused for a sign-in that is too old for it. */
export function isReauthRequired(error: unknown): boolean {
  return statusFrom(error) === 401 && codeFrom(error) === REAUTH_REQUIRED
}

/**
 * Whether a refused request carried the token the store holds now. False
 * means the token changed since the request went out, as another action's
 * step-up confirmation does by swapping a fresher one in, so the refusal may
 * be out of date and a plain retry can succeed. Anything that cannot be
 * compared counts as current.
 * @param error - The rejection `isReauthRequired` recognised.
 * @returns False only when the request provably used an older token.
 */
export function sentWithCurrentToken(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return true
  const sent = error.config?.headers.get('Authorization')
  const current = useAuthStore.getState().accessToken
  return typeof sent !== 'string' || current === null || sent === `Bearer ${current}`
}

/**
 * How long an emailed "Confirm it's you" link works after it is sent: 15
 * minutes, mirroring express's `STEP_UP_LINK_TTL` default (`15m`). Past it,
 * the dialog says the link expired and offers a new one.
 */
export const STEP_UP_LINK_TTL_MS = 15 * 60_000

/**
 * The shortest gap between two step-up link mails: 1 minute, mirroring
 * express's `STEP_UP_LINK_COOLDOWN` default (`1m`). A cooldown's `Retry-After`
 * subtracted from it says how long ago the waiting link went out.
 */
export const STEP_UP_LINK_COOLDOWN_MS = 60_000

/**
 * The `auth_time` claim of an access token: when its session last
 * authenticated, in whole seconds since the epoch. The payload is read
 * unverified, which is enough to decide whether to retry: the API checks the
 * signature on the retry itself.
 * @param token - An access token, or null.
 * @returns The claim, or null for no token, a token that is not a JWT, or one without the claim.
 */
export function authTimeOf(token: string | null): number | null {
  const payload = token?.split('.')[1]
  if (!payload) return null
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const claims: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')))
    if (typeof claims !== 'object' || claims === null || !('auth_time' in claims)) return null
    return typeof claims.auth_time === 'number' ? claims.auth_time : null
  } catch {
    return null
  }
}

/**
 * Whether a refresh after `step_up_confirmed` brought a confirmation this
 * tab did not have: the new token's `auth_time` is later than the one held
 * when the wait began. A session that had no `auth_time` gains one only by
 * confirming. Both values are the API's clock, so a skewed device clock never
 * decides it. A stray or forged message brings no newer claim, and is ignored.
 * @param before - `auth_time` of the token held when the wait began.
 * @param after - `auth_time` of the token the refresh brought.
 */
export function isNewConfirmation(before: number | null, after: number | null): boolean {
  return after !== null && (before === null || after > before)
}

/** The REAUTH_REQUIRED refusals that came back after a confirmation, not a dismissal. */
const refusedAfterConfirm = new WeakSet<object>()

/**
 * Marks a refusal of the retry that followed a confirmation, so the action's
 * dialog can say the confirmation did not take rather than ask for one.
 * @param error - The retry's rejection.
 */
export function markRefusedAfterConfirm(error: unknown): void {
  if (typeof error === 'object' && error !== null) refusedAfterConfirm.add(error)
}

/** Step-up was dismissed, so the action never ran. */
const STEP_UP_DISMISSED = 'Confirm it’s you to continue.'

/** The retry after a confirmation was refused again: the confirmation did not reach the API. */
const STEP_UP_NOT_CONFIRMED = 'We couldn’t confirm it’s you. Try the action again.'

/**
 * What a REAUTH_REQUIRED from `useStepUp().run` means to the person: they
 * dismissed "Confirm it's you", or they confirmed and the retry was still
 * refused (`markRefusedAfterConfirm`).
 * @param error - A rejection `isReauthRequired` recognised.
 */
export function stepUpRefusal(error: unknown): string {
  return typeof error === 'object' && error !== null && refusedAfterConfirm.has(error)
    ? STEP_UP_NOT_CONFIRMED
    : STEP_UP_DISMISSED
}
