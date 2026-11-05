/**
 * @file The WebAuthn JSON shapes and the port the shared passkey queries call
 * them through. The shapes are structurally the ones `@simplewebauthn/browser`
 * declares, copied here so a shared file never imports that package.
 */
import type { User } from '@/types/api.types'
import type { PublicPasskey } from '@/types/passkey.types'

/** A base64url-encoded string. */
type Base64URLString = string
/** Bytes, as the DOM's `BufferSource`. */
type BufferLike = ArrayBufferView | ArrayBuffer

/** Inputs or outputs of the PRF extension. */
interface PrfValues {
  first: BufferLike
  second?: BufferLike
}

/** The extension inputs a request may carry. */
interface ClientInputs {
  appid?: string
  credProps?: boolean
  hmacCreateSecret?: boolean
  minPinLength?: boolean
  prf?: { eval?: PrfValues; evalByCredential?: Record<string, PrfValues> }
}

/** The extension outputs a response carries. */
interface ClientOutputs {
  appid?: boolean
  credProps?: { rk?: boolean }
  hmacCreateSecret?: boolean
  prf?: { enabled?: boolean; results?: PrfValues }
}

/** A credential the server names, as JSON. */
interface DescriptorJSON {
  id: Base64URLString
  transports?: string[]
  type: string
}

/** Which kind of authenticator the browser should lead with. */
type Hint = 'hybrid' | 'security-key' | 'client-device'
/** How strongly the authenticator must verify the person. */
type UserVerification = 'discouraged' | 'preferred' | 'required'

/** The server's options for `navigator.credentials.get`, as JSON. */
export interface PublicKeyCredentialRequestOptionsJSON {
  challenge: Base64URLString
  timeout?: number
  rpId?: string
  allowCredentials?: DescriptorJSON[]
  userVerification?: UserVerification
  hints?: Hint[]
  extensions?: ClientInputs
}

/** The server's options for `navigator.credentials.create`, as JSON. */
export interface PublicKeyCredentialCreationOptionsJSON {
  rp: { name: string; id?: string }
  user: { id: string; name: string; displayName: string }
  challenge: Base64URLString
  pubKeyCredParams: { alg: number; type: 'public-key' }[]
  timeout?: number
  excludeCredentials?: DescriptorJSON[]
  authenticatorSelection?: {
    authenticatorAttachment?: 'cross-platform' | 'platform'
    requireResidentKey?: boolean
    residentKey?: 'discouraged' | 'preferred' | 'required'
    userVerification?: UserVerification
  }
  hints?: Hint[]
  attestation?: 'direct' | 'enterprise' | 'indirect' | 'none'
  attestationFormats?: (
    | 'fido-u2f'
    | 'packed'
    | 'android-safetynet'
    | 'android-key'
    | 'tpm'
    | 'apple'
    | 'none'
  )[]
  extensions?: ClientInputs
}

/** A passkey assertion, as JSON, to send to the server. */
export interface AuthenticationResponseJSON {
  id: Base64URLString
  rawId: Base64URLString
  response: {
    clientDataJSON: Base64URLString
    authenticatorData: Base64URLString
    signature: Base64URLString
    userHandle?: Base64URLString
  }
  authenticatorAttachment?: 'cross-platform' | 'platform'
  clientExtensionResults: ClientOutputs
  type: 'public-key'
}

/** A new passkey's attestation, as JSON, to send to the server. */
export interface RegistrationResponseJSON {
  id: Base64URLString
  rawId: Base64URLString
  response: {
    clientDataJSON: Base64URLString
    attestationObject: Base64URLString
    authenticatorData?: Base64URLString
    transports?: string[]
    publicKeyAlgorithm?: number
    publicKey?: Base64URLString
  }
  authenticatorAttachment?: 'cross-platform' | 'platform'
  clientExtensionResults: ClientOutputs
  type: 'public-key'
}

/** What the shared passkey queries need from the platform's WebAuthn. Each app writes its own. */
export interface WebAuthnPort {
  /** Whether a passkey can be created, and whether autofill can offer one. */
  isSupported(): Promise<{ create: boolean; autofill: boolean }>
  /** Asks for an assertion; `since` is a `cancelGeneration()` read earlier. */
  get(
    options: PublicKeyCredentialRequestOptionsJSON,
    mode: 'modal' | 'autofill',
    since?: number
  ): Promise<AuthenticationResponseJSON>
  /** Asks for a new passkey. */
  create(options: PublicKeyCredentialCreationOptionsJSON): Promise<RegistrationResponseJSON>
  /** A number that changes whenever a pending prompt is cancelled. */
  cancelGeneration(): number
  /** Hints that a credential the server refused should stop being offered. */
  signalUnknown(rpId: string, credentialId: string): void
  /** Hints which passkeys the account still holds. */
  signalAccepted(rpId: string, userHandle: string, passkeys: readonly PublicPasskey[]): void
  /** Hints the name to show beside the account's passkeys. */
  signalUser(rpId: string, user: Pick<User, 'id' | 'email' | 'firstName' | 'lastName'>): void
}
