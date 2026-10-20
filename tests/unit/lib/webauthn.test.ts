import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelPasskeyPrompt,
  createPasskeyCredential,
  PASSKEY_SIGNALS,
  passkeyFailure,
  passkeySupport,
  requestPasskey,
  signalAcceptedPasskeys,
  signalPasskeyUser,
  signalUnknownPasskey,
  webauthnUserId,
} from '@/lib/webauthn'
import type { PublicPasskey } from '@/types/passkey.types'

const mocks = vi.hoisted(() => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
  browserSupportsWebAuthnAutofill: vi.fn(),
  cancelCeremony: vi.fn(),
}))

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: mocks.startAuthentication,
  startRegistration: mocks.startRegistration,
  browserSupportsWebAuthnAutofill: mocks.browserSupportsWebAuthnAutofill,
  WebAuthnAbortService: { cancelCeremony: mocks.cancelCeremony },
  WebAuthnError: class extends Error {
    code = ''
  },
}))

const OPTIONS = { challenge: 'abc' } as never

/** A passkey row with only the field the signal reads. */
function passkey(credentialId: string): PublicPasskey {
  return { credentialId } as PublicPasskey
}

describe('webauthn', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(window, 'PublicKeyCredential')
    mocks.startAuthentication.mockReset()
    mocks.startRegistration.mockReset()
    mocks.browserSupportsWebAuthnAutofill.mockReset()
    mocks.cancelCeremony.mockReset()
  })

  it('encodes the user id as the 16 UUID bytes, base64url', () => {
    expect(webauthnUserId('00000000-0000-0000-0000-000000000001')).toBe('AAAAAAAAAAAAAAAAAAAAAQ')
    expect(webauthnUserId('ffffffff-ffff-ffff-ffff-fffffffffffe')).toBe('_____________________g')
  })

  it('reports no support without PublicKeyCredential', async () => {
    expect(await passkeySupport()).toEqual({ create: false, autofill: false })
  })

  it('reports create and the package’s autofill answer with PublicKeyCredential', async () => {
    vi.stubGlobal('PublicKeyCredential', class {})
    mocks.browserSupportsWebAuthnAutofill.mockResolvedValue(true)
    expect(await passkeySupport()).toEqual({ create: true, autofill: true })
    mocks.browserSupportsWebAuthnAutofill.mockResolvedValue(false)
    expect(await passkeySupport()).toEqual({ create: true, autofill: false })
  })

  it('classifies cancel, previously-registered, unsupported and other failures', () => {
    expect(passkeyFailure(new DOMException('x', 'NotAllowedError'))).toBe('cancelled')
    expect(passkeyFailure(new DOMException('x', 'AbortError'))).toBe('cancelled')
    expect(passkeyFailure(Object.assign(new Error('x'), { code: 'ERROR_CEREMONY_ABORTED' }))).toBe(
      'cancelled'
    )
    expect(
      passkeyFailure(
        Object.assign(new Error('x'), { code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' })
      )
    ).toBe('already_registered')
    expect(passkeyFailure(new DOMException('x', 'InvalidStateError'))).toBe('already_registered')
    expect(passkeyFailure(new DOMException('x', 'NotSupportedError'))).toBe('unsupported')
    expect(passkeyFailure(new Error('x'))).toBe('failed')
    expect(passkeyFailure('x')).toBe('failed')
    expect(passkeyFailure(null)).toBe('failed')
  })

  it('passes useBrowserAutofill only in autofill mode', async () => {
    mocks.startAuthentication.mockResolvedValue({ id: 'r' })
    await requestPasskey(OPTIONS, 'modal')
    expect(mocks.startAuthentication).toHaveBeenLastCalledWith({ optionsJSON: OPTIONS })
    await requestPasskey(OPTIONS, 'autofill')
    expect(mocks.startAuthentication).toHaveBeenLastCalledWith({
      optionsJSON: OPTIONS,
      useBrowserAutofill: true,
    })
  })

  it('creates a credential from the options', async () => {
    mocks.startRegistration.mockResolvedValue({ id: 'c' })
    await expect(createPasskeyCredential(OPTIONS)).resolves.toEqual({ id: 'c' })
    expect(mocks.startRegistration).toHaveBeenCalledWith({ optionsJSON: OPTIONS })
  })

  it('cancels the pending ceremony once the package has loaded', async () => {
    mocks.startAuthentication.mockResolvedValue({ id: 'r' })
    await requestPasskey(OPTIONS, 'modal')
    cancelPasskeyPrompt()
    expect(mocks.cancelCeremony).toHaveBeenCalledTimes(1)
  })

  describe('signals', () => {
    let unknown: ReturnType<typeof vi.fn>
    let accepted: ReturnType<typeof vi.fn>
    let details: ReturnType<typeof vi.fn>

    beforeEach(() => {
      unknown = vi.fn().mockResolvedValue(undefined)
      accepted = vi.fn().mockRejectedValue(new Error('boom'))
      details = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('PublicKeyCredential', {
        signalUnknownCredential: unknown,
        signalAllAcceptedCredentials: accepted,
        signalCurrentUserDetails: details,
      })
    })

    it('sends signalAllAcceptedCredentials with the answer’s userHandle and every credentialId, and swallows its rejection', async () => {
      expect(() =>
        signalAcceptedPasskeys('localhost', 'HANDLE', [passkey('c1'), passkey('c2')])
      ).not.toThrow()
      expect(accepted).toHaveBeenCalledWith({
        rpId: 'localhost',
        userId: 'HANDLE',
        allAcceptedCredentialIds: ['c1', 'c2'],
      })
      await Promise.resolve()
    })

    it('sends signalUnknownCredential and signalCurrentUserDetails', () => {
      signalUnknownPasskey('localhost', 'cx')
      expect(unknown).toHaveBeenCalledWith({ rpId: 'localhost', credentialId: 'cx' })
      signalPasskeyUser('localhost', {
        id: '00000000-0000-0000-0000-000000000001',
        email: 'a@b.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
      })
      expect(details).toHaveBeenCalledWith({
        rpId: 'localhost',
        userId: 'AAAAAAAAAAAAAAAAAAAAAQ',
        name: 'a@b.com',
        displayName: 'Ada Lovelace',
      })
      signalPasskeyUser('localhost', {
        id: '00000000-0000-0000-0000-000000000001',
        email: 'a@b.com',
        firstName: null,
        lastName: null,
      })
      expect(details).toHaveBeenLastCalledWith(expect.objectContaining({ displayName: 'a@b.com' }))
    })

    it('does nothing for a signal the browser lacks, or that PASSKEY_SIGNALS turns off', () => {
      vi.stubGlobal('PublicKeyCredential', {})
      expect(() => signalUnknownPasskey('localhost', 'cx')).not.toThrow()
      expect(() => signalAcceptedPasskeys('localhost', 'H', [])).not.toThrow()
      expect(unknown).not.toHaveBeenCalled()

      vi.stubGlobal('PublicKeyCredential', { signalUnknownCredential: unknown })
      const mutable = PASSKEY_SIGNALS as { unknownCredential: boolean }
      mutable.unknownCredential = false
      try {
        signalUnknownPasskey('localhost', 'cx')
      } finally {
        mutable.unknownCredential = true
      }
      expect(unknown).not.toHaveBeenCalled()
    })

    it('does nothing without PublicKeyCredential', () => {
      Reflect.deleteProperty(window, 'PublicKeyCredential')
      expect(() => signalUnknownPasskey('localhost', 'cx')).not.toThrow()
    })

    it('swallows a signal that throws synchronously', () => {
      unknown.mockImplementation(() => {
        throw new Error('sync')
      })
      expect(() => signalUnknownPasskey('localhost', 'cx')).not.toThrow()
    })
  })
})
