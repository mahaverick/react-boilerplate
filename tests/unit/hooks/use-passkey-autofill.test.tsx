import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { StrictMode, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { usePasskeyAutofill } from '@/hooks/use-passkey-autofill'
import { toast } from '@/lib/toast'
import { passkeyKeys } from '@/queries/passkey.queries'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const webauthn = vi.hoisted(() => ({ support: vi.fn(), request: vi.fn(), cancel: vi.fn() }))

vi.mock('@/lib/webauthn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/webauthn')>()),
  passkeySupport: webauthn.support,
  requestPasskey: webauthn.request,
  cancelPasskeyPrompt: webauthn.cancel,
}))

vi.mock('@/observability/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/observability/telemetry')>()),
  track: vi.fn(),
  yieldSharedIdentity: vi.fn(),
}))

describe('usePasskeyAutofill', () => {
  /** Wraps the hook in a fresh query client. */
  function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  beforeEach(() => {
    webauthn.support.mockReset().mockResolvedValue({ create: true, autofill: true })
    webauthn.request.mockReset().mockReturnValue(new Promise(() => undefined))
    webauthn.cancel.mockReset()
    server.use(
      http.post('/api/v1/auth/passkeys/sign-in/options', () =>
        ok({ challengeId: 'c', options: {} }, 'Options.')
      ),
      http.post('/api/v1/auth/passkeys/sign-in/verify', () =>
        ok({ user: testUser, accessToken: 't', isNewUser: false, redirect: null }, 'Signed in.')
      )
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('asks for nothing while disabled, and checks no support', async () => {
    renderHook(() => usePasskeyAutofill({ enabled: false, onSignedIn: vi.fn() }), { wrapper })

    await waitFor(() => expect(webauthn.support).not.toHaveBeenCalled())
    expect(webauthn.request).not.toHaveBeenCalled()
  })

  it('asks for nothing where the browser has no autofill', async () => {
    webauthn.support.mockResolvedValue({ create: true, autofill: false })
    renderHook(() => usePasskeyAutofill({ enabled: true, onSignedIn: vi.fn() }), { wrapper })

    await waitFor(() => expect(webauthn.support).toHaveBeenCalled())
    expect(webauthn.request).not.toHaveBeenCalled()
  })

  it('cancels the request when enabled turns false and asks again when it turns true', async () => {
    const { rerender } = renderHook(
      ({ enabled }) => usePasskeyAutofill({ enabled, onSignedIn: vi.fn() }),
      { wrapper, initialProps: { enabled: true } }
    )
    await waitFor(() => expect(webauthn.request).toHaveBeenCalledTimes(1))

    rerender({ enabled: false })
    expect(webauthn.cancel).toHaveBeenCalled()

    rerender({ enabled: true })
    await waitFor(() => expect(webauthn.request).toHaveBeenCalledTimes(2))
  })

  it('asks again when restartKey changes', async () => {
    const { rerender } = renderHook(
      ({ restartKey }) => usePasskeyAutofill({ enabled: true, onSignedIn: vi.fn(), restartKey }),
      { wrapper, initialProps: { restartKey: 0 } }
    )
    await waitFor(() => expect(webauthn.request).toHaveBeenCalledTimes(1))

    rerender({ restartKey: 1 })
    await waitFor(() => expect(webauthn.request).toHaveBeenCalledTimes(2))
  })

  it('calls onSignedIn after a pick', async () => {
    webauthn.request.mockResolvedValue({ id: 'cred' })
    const onSignedIn = vi.fn()
    renderHook(() => usePasskeyAutofill({ enabled: true, onSignedIn }), { wrapper })

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1))
  })

  it('starts one request under StrictMode when the support answer is already cached', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    client.setQueryData(passkeyKeys.support, { create: true, autofill: true })
    renderHook(() => usePasskeyAutofill({ enabled: true, onSignedIn: vi.fn() }), {
      wrapper: ({ children }) => (
        <StrictMode>
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        </StrictMode>
      ),
    })

    await waitFor(() => expect(webauthn.request).toHaveBeenCalled())
    await settle(50, 'let a stray second request show up')
    expect(webauthn.request).toHaveBeenCalledTimes(1)
  })

  it('leaves one live ceremony after a mount is discarded and another follows', async () => {
    // StrictMode does not double-run effects under this test setup, so the discard is made by hand.
    const real = await vi.importActual<typeof import('@/lib/webauthn')>('@/lib/webauthn')
    // The wrapper's own rule: a request begun before a cancel is aborted.
    webauthn.cancel.mockImplementation(real.cancelPasskeyPrompt)
    let live = 0
    webauthn.request.mockImplementation((_options: unknown, _mode: unknown, since: number) => {
      if (since !== real.passkeyCancelGeneration()) {
        return Promise.reject(new DOMException('cancelled', 'AbortError'))
      }
      live += 1
      return new Promise(() => undefined)
    })
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    client.setQueryData(passkeyKeys.support, { create: true, autofill: true })
    /** Mounts the hook against the shared client. */
    const mount = () =>
      renderHook(() => usePasskeyAutofill({ enabled: true, onSignedIn: vi.fn() }), {
        wrapper: ({ children }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      })

    mount().unmount()
    mount()

    await waitFor(() => expect(live).toBeGreaterThan(0))
    await settle(50, 'let a stray second live ceremony show up')
    expect(live).toBe(1)
  })

  it('stays quiet when the browser refuses the background request as not supported', async () => {
    const toastError = vi.spyOn(toast, 'error')
    // Headless Chrome with no authenticator answers a conditional request this way.
    webauthn.request.mockRejectedValue(
      new DOMException('Resident credentials are not supported.', 'NotSupportedError')
    )
    renderHook(() => usePasskeyAutofill({ enabled: true, onSignedIn: vi.fn() }), { wrapper })

    await waitFor(() => expect(webauthn.request).toHaveBeenCalledTimes(1))
    await settle(50, 'a toast that never comes has no event')
    expect(toastError).not.toHaveBeenCalled()
  })

  it('stays quiet when the options request fails or never reaches the server', async () => {
    const toastError = vi.spyOn(toast, 'error')
    let posts = 0
    server.use(
      http.post('/api/v1/auth/passkeys/sign-in/options', () => {
        posts += 1
        return posts === 1 ? fail('The server failed.', 500) : HttpResponse.error()
      })
    )
    const { rerender } = renderHook(
      ({ restartKey }) => usePasskeyAutofill({ enabled: true, onSignedIn: vi.fn(), restartKey }),
      { wrapper, initialProps: { restartKey: 0 } }
    )
    await waitFor(() => expect(posts).toBe(1))
    rerender({ restartKey: 1 })
    await waitFor(() => expect(posts).toBe(2))

    await settle(50, 'a toast that never comes has no event')
    expect(toastError).not.toHaveBeenCalled()
    expect(webauthn.request).not.toHaveBeenCalled()
  })

  it('toasts the server refusing a passkey the person picked', async () => {
    const toastError = vi.spyOn(toast, 'error')
    webauthn.request.mockResolvedValue({ id: 'cred' })
    server.use(
      http.post('/api/v1/auth/passkeys/sign-in/verify', () =>
        fail('This passkey can’t sign in here.', 403, 'PASSKEY_NO_ACCESS')
      )
    )
    renderHook(() => usePasskeyAutofill({ enabled: true, onSignedIn: vi.fn() }), { wrapper })

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('This passkey can’t sign in here.'))
    expect(webauthn.request).toHaveBeenCalledTimes(1)
  })

  it('posts one sign-in options request under StrictMode', async () => {
    let posts = 0
    server.use(
      http.post('/api/v1/auth/passkeys/sign-in/options', () => {
        posts += 1
        return ok({ challengeId: 'c', options: {} }, 'Options.')
      })
    )
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    client.setQueryData(passkeyKeys.support, { create: true, autofill: true })
    renderHook(() => usePasskeyAutofill({ enabled: true, onSignedIn: vi.fn() }), {
      wrapper: ({ children }) => (
        <StrictMode>
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        </StrictMode>
      ),
    })

    await waitFor(() => expect(webauthn.request).toHaveBeenCalled())
    await settle(50, 'let a stray second options request show up')
    expect(posts).toBe(1)
  })
})
