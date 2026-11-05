/**
 * @file The WebAuthn port: passkey ceremonies and signals for the shared
 * queries. Each app writes its own copy; this one is the browser's.
 */
import {
  createPasskeyCredential,
  passkeyCancelGeneration,
  passkeySupport,
  requestPasskey,
  signalAcceptedPasskeys,
  signalPasskeyUser,
  signalUnknownPasskey,
} from '@/lib/webauthn'
import type { WebAuthnPort } from '@/types/webauthn.types'

/** The browser's WebAuthn, built from `lib/webauthn`. */
export const webauthn: WebAuthnPort = {
  isSupported: passkeySupport,
  get: requestPasskey,
  create: createPasskeyCredential,
  cancelGeneration: passkeyCancelGeneration,
  signalUnknown: signalUnknownPasskey,
  signalAccepted: signalAcceptedPasskeys,
  signalUser: signalPasskeyUser,
}
