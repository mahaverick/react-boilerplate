import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
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

/** A promise and the function that settles it. */
function openGate() {
  let settle!: () => void
  const held = new Promise<void>((resolve) => {
    settle = resolve
  })
  return { held, release: () => settle() }
}

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
    // The request is held until the cancel has landed, so no runner's speed decides which comes first.
    const gate = openGate()
    server.use(
      http.post('/api/v1/auth/passkeys/sign-in/options', async () => {
        requested = true
        await gate.held
        return ok({ challengeId: 'c', options: {} }, 'Options.')
      })
    )
    const { result } = renderHook(() => usePasskeySignIn(), { wrapper })

    const attempt = result.current.mutateAsync('modal')
    const settled = attempt.then(
      () => null,
      (error: unknown) => error
    )
    try {
      await waitFor(() => expect(requested).toBe(true))
      cancelPasskeyPrompt()
      gate.release()

      expect(passkeyFailure(await settled)).toBe('cancelled')
      expect(mocks.startAuthentication).not.toHaveBeenCalled()
    } finally {
      // Releasing twice is harmless; a failed assertion must not leave the request held.
      gate.release()
    }
  })
})
