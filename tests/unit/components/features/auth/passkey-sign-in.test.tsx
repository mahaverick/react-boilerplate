import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PasskeySignInButton } from '@/components/features/auth/passkey-sign-in'
import { toast } from '@/lib/toast'
import { track } from '@/observability/telemetry'
import { fail, ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const webauthn = vi.hoisted(() => ({ support: vi.fn(), request: vi.fn() }))

vi.mock('@/lib/webauthn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/webauthn')>()),
  passkeySupport: webauthn.support,
  requestPasskey: webauthn.request,
}))

vi.mock('@/observability/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/observability/telemetry')>()),
  track: vi.fn(),
}))

/** Renders the button with spies for both outcomes. */
function renderButton() {
  const onSignedIn = vi.fn()
  const onModalSettled = vi.fn()
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <PasskeySignInButton onSignedIn={onSignedIn} onModalSettled={onModalSettled} />
    </QueryClientProvider>
  )
  return { onSignedIn, onModalSettled }
}

describe('PasskeySignInButton', () => {
  beforeEach(() => {
    webauthn.support.mockReset().mockResolvedValue({ create: true, autofill: false })
    webauthn.request.mockReset()
    vi.mocked(track).mockClear()
    server.use(
      http.post('/api/v1/auth/passkeys/sign-in/options', () =>
        ok({ challengeId: 'c', options: {} }, 'Options.')
      )
    )
  })

  it('renders nothing where the browser cannot use passkeys', async () => {
    webauthn.support.mockResolvedValue({ create: false, autofill: false })
    renderButton()

    await waitFor(() => expect(webauthn.support).toHaveBeenCalled())
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the waiting label while the prompt is open', async () => {
    webauthn.request.mockReturnValue(new Promise(() => undefined))
    renderButton()

    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Sign in with a passkey' }))

    expect(await screen.findByRole('button', { name: 'Waiting for your passkey…' })).toBeDisabled()
  })

  it('reports a dismissed prompt as settled, tracks it and stays quiet', async () => {
    const toastError = vi.spyOn(toast, 'error')
    webauthn.request.mockRejectedValue(new DOMException('no', 'NotAllowedError'))
    const { onModalSettled, onSignedIn } = renderButton()

    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Sign in with a passkey' }))

    await waitFor(() => expect(onModalSettled).toHaveBeenCalledTimes(1))
    expect(track).toHaveBeenCalledWith('passkey_prompt_cancelled', { ceremony: 'sign_in' })
    expect(toastError).not.toHaveBeenCalled()
    expect(onSignedIn).not.toHaveBeenCalled()
  })

  it('toasts a 429 with its wait and reports the prompt as settled', async () => {
    const toastError = vi.spyOn(toast, 'error')
    webauthn.request.mockResolvedValue({ id: 'cred' })
    server.use(
      http.post('/api/v1/auth/passkeys/sign-in/verify', () =>
        fail('Slow down.', 429, 'RATE_LIMITED')
      )
    )
    const { onModalSettled } = renderButton()

    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Sign in with a passkey' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Slow down.'))
    expect(onModalSettled).toHaveBeenCalledTimes(1)
  })
})
