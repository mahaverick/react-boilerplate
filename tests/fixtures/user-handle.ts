/**
 * @file The WebAuthn user handle of the signed-in test user, derived once. It is not a UUID, so
 * it lives beside `ids.ts`, whose exports are all checked to be UUIDs.
 */
import { USER_ID } from './ids'

/**
 * The WebAuthn user handle for `USER_ID`: its 16 bytes, base64url. The harness lists it and the
 * e2e virtual authenticator is seeded with it, so both read this one value.
 */
export const USER_HANDLE = btoa(
  String.fromCharCode(
    ...USER_ID.replaceAll('-', '')
      .match(/../g)!
      .map((byte) => parseInt(byte, 16))
  )
)
  .replaceAll('+', '-')
  .replaceAll('/', '_')
  .replaceAll('=', '')
