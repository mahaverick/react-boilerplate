import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { delay, http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelPasskeyPrompt, passkeyFailure } from '@/lib/webauthn'
import { usePasskeySignIn } from '@/queries/passkey.queries'
import { ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const mocks = vi.hoisted(() => ({
  startAuthentication: vi.fn(),
  browserSupportsWebAuthnAutofill: vi.fn(),
  cancelCeremony: vi.fn(),
}))

// Only the package is mocked: the wrapper, with its cancel counter, is the real one.
vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: mocks.startAuthentication,
  startRegistration: vi.fn(),
  browserSupportsWebAuthnAutofill: mocks.browserSupportsWebAuthnAutofill,
  WebAuthnAbortService: { cancelCeremony: mocks.cancelCeremony },
  WebAuthnError: class extends Error {
    code = ''
  },
}))

describe('usePasskeySignIn with the real wrapper', () => {
  /** Wraps the hook in a fresh query client. */
  function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  beforeEach(() => {
    mocks.startAuthentication.mockReset()
  })

  it('starts no ceremony when a cancel lands while the options request is in flight', async () => {
    let requested = false
    server.use(
      http.post('/api/v1/auth/passkeys/sign-in/options', async () => {
        requested = true
        await delay(60)
        return ok({ challengeId: 'c', options: {} }, 'Options.')
      })
    )
    const { result } = renderHook(() => usePasskeySignIn(), { wrapper })

    const attempt = result.current.mutateAsync('modal')
    const settled = attempt.then(
      () => null,
      (error: unknown) => error
    )
    await waitFor(() => expect(requested).toBe(true))
    cancelPasskeyPrompt()

    expect(passkeyFailure(await settled)).toBe('cancelled')
    expect(mocks.startAuthentication).not.toHaveBeenCalled()
  })
})
