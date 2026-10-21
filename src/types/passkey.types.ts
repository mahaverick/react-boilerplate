import { codeFrom, statusFrom } from '@/lib/api-error'
import type { User } from '@/types/api.types'

/** How passkeys are offered: not at all, alongside email and Google, or required of every account. */
export type PasskeyMode = 'off' | 'optional' | 'required'

/** `GET /auth/passkeys/config`: the mode and the relying-party id the browser binds passkeys to. */
export interface PasskeyConfig {
  mode: PasskeyMode
  rpId: string
}

/** The authenticator that holds a passkey, with its icons as `data:` URIs. */
export interface PasskeyProvider {
  name: string
  iconLight: string | null
  iconDark: string | null
}

/** One passkey as the API lists it. `credentialId` is base64url. */
export interface PublicPasskey {
  id: string
  name: string
  provider: PasskeyProvider
  synced: boolean
  createdAt: string
  lastUsedAt: string | null
  credentialId: string
}

/** The list and delete answer: the passkeys oldest first, and the account's WebAuthn user handle (base64url). */
export interface PasskeyList {
  passkeys: PublicPasskey[]
  userHandle: string
}

/** A ceremony's options and the id of the challenge the server holds for them. */
export interface PasskeyChallenge<O> {
  challengeId: string
  options: O
}

/** The answer to `POST /auth/passkeys/sign-in/verify`. */
export interface PasskeySignIn {
  accessToken: string
  user: User
  isNewUser: false
  redirect: null
}

/** `code`: no passkey matches the one the browser offered. */
export const PASSKEY_UNKNOWN = 'PASSKEY_UNKNOWN'
/** `code`: a known passkey whose account cannot sign in to this app. */
export const PASSKEY_NO_ACCESS = 'PASSKEY_NO_ACCESS'
/** `code`: this authenticator already holds a passkey for the account. */
export const PASSKEY_EXISTS = 'PASSKEY_EXISTS'
/** `code`: the server could not verify the browser's response. */
export const PASSKEY_VERIFICATION_FAILED = 'PASSKEY_VERIFICATION_FAILED'
/** `code`: required mode, and the account has no passkey yet. */
export const PASSKEY_SETUP_REQUIRED = 'PASSKEY_SETUP_REQUIRED'
/** `code`: the account holds the most passkeys it may. */
export const PASSKEY_LIMIT = 'PASSKEY_LIMIT'
/** `code`: the passkey is the account's last, and the account needs one. */
export const LAST_PASSKEY = 'LAST_PASSKEY'
/** `code`: step-up by passkey was asked for, and the account has none. */
export const NO_PASSKEY = 'NO_PASSKEY'
/** `code`: creating a passkey needs a verified email address. */
export const EMAIL_UNVERIFIED = 'EMAIL_UNVERIFIED'
/** `code`: a step-up link was requested again inside its cooldown. */
export const STEP_UP_LINK_COOLDOWN = 'STEP_UP_LINK_COOLDOWN'

/** The most passkeys one account holds. */
export const MAX_PASSKEYS = 20

/** The longest passkey name, in characters. */
export const PASSKEY_NAME_MAX_LENGTH = 64

/**
 * Whether `error` is the 403 that required mode answers while the account has
 * no passkey.
 * @param error - A rejection from any request.
 * @returns True for a 403 with code `PASSKEY_SETUP_REQUIRED`.
 */
export function isPasskeySetupRequired(error: unknown): boolean {
  return statusFrom(error) === 403 && codeFrom(error) === PASSKEY_SETUP_REQUIRED
}
