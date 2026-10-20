import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser'
import { fullName } from '@/lib/format'
import type { User } from '@/types/api.types'
import type { PublicPasskey } from '@/types/passkey.types'

export type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser'

/** The browser package, loaded on first use so no first-visit chunk carries it. */
type WebAuthnModule = typeof import('@simplewebauthn/browser')

/** The loaded module once something asked for it; `cancelPasskeyPrompt` needs no load. */
let loaded: WebAuthnModule | null = null

/** The one in-flight or settled load. */
let loading: Promise<WebAuthnModule> | null = null

/**
 * Loads `@simplewebauthn/browser` once. A failed load is forgotten, so the
 * next call tries again.
 */
function loadWebAuthn(): Promise<WebAuthnModule> {
  loading ??= import('@simplewebauthn/browser').then(
    (module) => {
      loaded = module
      return module
    },
    (error: unknown) => {
      loading = null
      throw error
    }
  )
  return loading
}

/**
 * What this browser can do with passkeys. Both are false without
 * `window.PublicKeyCredential`; `autofill` is the package's check for
 * conditional mediation.
 * @returns Whether a passkey can be created, and whether autofill can offer one.
 */
export async function passkeySupport(): Promise<{ create: boolean; autofill: boolean }> {
  if (typeof window === 'undefined' || !('PublicKeyCredential' in window)) {
    return { create: false, autofill: false }
  }
  try {
    const { browserSupportsWebAuthnAutofill } = await loadWebAuthn()
    return { create: true, autofill: await browserSupportsWebAuthnAutofill() }
  } catch {
    return { create: true, autofill: false }
  }
}

/**
 * Asks the browser for a passkey assertion. A new request cancels a pending one.
 * @param options - The server's request options.
 * @param mode - `modal` opens the browser's passkey sheet; `autofill` waits behind the page's `webauthn` input.
 * @returns The assertion to send to the server.
 */
export async function requestPasskey(
  options: PublicKeyCredentialRequestOptionsJSON,
  mode: 'modal' | 'autofill'
): Promise<AuthenticationResponseJSON> {
  const { startAuthentication } = await loadWebAuthn()
  return startAuthentication(
    mode === 'autofill'
      ? { optionsJSON: options, useBrowserAutofill: true }
      : { optionsJSON: options }
  )
}

/**
 * Asks the browser to create a passkey. A new request cancels a pending one.
 * @param options - The server's creation options.
 * @returns The attestation to send to the server.
 */
export async function createPasskeyCredential(
  options: PublicKeyCredentialCreationOptionsJSON
): Promise<RegistrationResponseJSON> {
  const { startRegistration } = await loadWebAuthn()
  return startRegistration({ optionsJSON: options })
}

/** Cancels the pending passkey prompt, if any. Does nothing when the package never loaded. */
export function cancelPasskeyPrompt(): void {
  loaded?.WebAuthnAbortService.cancelCeremony()
}

/** Why a ceremony failed, as far as the UI words it differently. */
export type PasskeyFailure = 'cancelled' | 'already_registered' | 'unsupported' | 'failed'

/**
 * Sorts a ceremony's rejection. The package wraps DOM errors in a
 * `WebAuthnError` with a `code`; a raw `DOMException` carries only a `name`.
 * Both are read by shape, so this needs no load of the package.
 * @param error - What `requestPasskey` or `createPasskeyCredential` rejected with.
 * @returns The failure class.
 */
export function passkeyFailure(error: unknown): PasskeyFailure {
  if (typeof error !== 'object' || error === null) return 'failed'
  const { name, code } = error as { name?: unknown; code?: unknown }
  if (code === 'ERROR_CEREMONY_ABORTED' || name === 'NotAllowedError' || name === 'AbortError') {
    return 'cancelled'
  }
  if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' || name === 'InvalidStateError') {
    return 'already_registered'
  }
  if (name === 'NotSupportedError') return 'unsupported'
  return 'failed'
}

/**
 * The WebAuthn user id for an account: its UUID's 16 bytes as base64url,
 * mirroring express's `userHandleBytes`.
 * @param userId - The account's UUID.
 * @returns The base64url user handle.
 */
export function webauthnUserId(userId: string): string {
  const hex = userId.replaceAll('-', '')
  let binary = ''
  for (let index = 0; index < hex.length; index += 2) {
    binary += String.fromCharCode(Number.parseInt(hex.slice(index, index + 2), 16))
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/**
 * Which browser signals this app sends. Each can be turned off here, for a
 * browser whose implementation misbehaves.
 */
export const PASSKEY_SIGNALS: {
  readonly unknownCredential: boolean
  readonly allAcceptedCredentials: boolean
  readonly currentUserDetails: boolean
} = { unknownCredential: true, allAcceptedCredentials: true, currentUserDetails: true }

/** The signal methods the Web Authentication Level 3 spec adds to `PublicKeyCredential`; browsers ship them one by one. */
interface SignalApi {
  signalUnknownCredential?: (options: { rpId: string; credentialId: string }) => Promise<void>
  signalAllAcceptedCredentials?: (options: {
    rpId: string
    userId: string
    allAcceptedCredentialIds: string[]
  }) => Promise<void>
  signalCurrentUserDetails?: (options: {
    rpId: string
    userId: string
    name: string
    displayName: string
  }) => Promise<void>
}

/**
 * The browser's signal API, or `undefined` where `PublicKeyCredential` is missing.
 */
function signalApi(): SignalApi | undefined {
  if (typeof window === 'undefined' || !('PublicKeyCredential' in window)) return undefined
  const credential: unknown = window.PublicKeyCredential
  return credential as SignalApi
}

/**
 * Sends one signal, fire and forget: a missing method does nothing, and a
 * rejection (or a synchronous throw) is swallowed.
 * @param send - Calls the signal; runs only if the browser has it.
 */
function fireSignal(send: () => Promise<void> | undefined): void {
  try {
    void send()?.catch(() => undefined)
  } catch {
    // A signal is a hint to the browser; a failure to send one changes nothing.
  }
}

/**
 * Tells the browser a credential the server does not know, so it stops offering it.
 * @param rpId - The relying-party id from the passkey config.
 * @param credentialId - The base64url credential id the server refused.
 */
export function signalUnknownPasskey(rpId: string, credentialId: string): void {
  if (!PASSKEY_SIGNALS.unknownCredential) return
  const api = signalApi()
  if (!api?.signalUnknownCredential) return
  fireSignal(() => api.signalUnknownCredential?.({ rpId, credentialId }))
}

/**
 * Tells the browser which credentials the account still holds, so it drops the rest.
 * @param rpId - The relying-party id from the passkey config.
 * @param userHandle - The account's user handle from the list or delete answer.
 * @param passkeys - Every passkey the account holds now.
 */
export function signalAcceptedPasskeys(
  rpId: string,
  userHandle: string,
  passkeys: readonly PublicPasskey[]
): void {
  if (!PASSKEY_SIGNALS.allAcceptedCredentials) return
  const api = signalApi()
  if (!api?.signalAllAcceptedCredentials) return
  fireSignal(() =>
    api.signalAllAcceptedCredentials?.({
      rpId,
      userId: userHandle,
      allAcceptedCredentialIds: passkeys.map((passkey) => passkey.credentialId),
    })
  )
}

/**
 * Tells the browser the name to show beside the account's passkeys.
 * @param rpId - The relying-party id from the passkey config.
 * @param user - The signed-in user.
 */
export function signalPasskeyUser(
  rpId: string,
  user: Pick<User, 'id' | 'email' | 'firstName' | 'lastName'>
): void {
  if (!PASSKEY_SIGNALS.currentUserDetails) return
  const api = signalApi()
  if (!api?.signalCurrentUserDetails) return
  fireSignal(() =>
    api.signalCurrentUserDetails?.({
      rpId,
      userId: webauthnUserId(user.id),
      name: user.email,
      displayName: fullName(user) ?? user.email,
    })
  )
}
