/**
 * @file A Chrome virtual authenticator for the passkey e2e tests. It drives
 * the DevTools Protocol `WebAuthn` domain, so it works in Playwright's Chromium
 * only, and it needs no hardware, prompt or user gesture.
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import type { Page } from '@playwright/test'

/** A credential the virtual authenticator holds, as `WebAuthn.getCredentials` returns it (binary fields are base64). */
interface VirtualCredential {
  credentialId: string
  isResidentCredential: boolean
  rpId?: string
  userHandle?: string
  signCount: number
}

/** What `addVirtualAuthenticator` hands a test. */
export interface VirtualAuthenticator {
  /** The authenticator's id in the DevTools Protocol. */
  id: string
  /** The credentials the authenticator holds now. */
  credentials(): Promise<VirtualCredential[]>
  /**
   * Puts a resident credential on the authenticator, as if the user had created
   * a passkey on this device earlier.
   * @param input.rpId - The relying party id, `localhost` in the harness.
   * @param input.userHandle - The user handle, base64url.
   * @returns The new credential's id, base64.
   */
  addResidentCredential(input: { rpId: string; userHandle: string }): Promise<string>
  /** Removes the authenticator and turns the WebAuthn domain off. */
  remove(): Promise<void>
}

/** Base64url to base64, the encoding the protocol takes for binary fields. */
function toBase64(value: string): string {
  return Buffer.from(value, 'base64url').toString('base64')
}

/**
 * Adds a CTAP2, internal, user-verifying virtual authenticator to `page`'s
 * context that answers every prompt by itself.
 * @param page - A page in a Chromium context.
 * @returns The authenticator and its helpers.
 */
export async function addVirtualAuthenticator(page: Page): Promise<VirtualAuthenticator> {
  const client = await page.context().newCDPSession(page)
  await client.send('WebAuthn.enable')
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })

  return {
    id: authenticatorId,
    async credentials() {
      const { credentials } = await client.send('WebAuthn.getCredentials', { authenticatorId })
      return credentials
    },
    async addResidentCredential({ rpId, userHandle }) {
      const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
      const credentialId = randomBytes(32).toString('base64')
      await client.send('WebAuthn.addCredential', {
        authenticatorId,
        credential: {
          credentialId,
          isResidentCredential: true,
          rpId,
          privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
          userHandle: toBase64(userHandle),
          signCount: 0,
        },
      })
      return credentialId
    },
    async remove() {
      await client.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
      await client.send('WebAuthn.disable')
      await client.detach()
    },
  }
}
