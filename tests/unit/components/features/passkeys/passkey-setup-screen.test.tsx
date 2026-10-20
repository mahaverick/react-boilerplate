import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pageTitle } from '@/constants/app'
import { resetSessionForTests } from '@/http/session'
import { toast } from '@/lib/toast'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { usePasskeySetupStore } from '@/states/passkey-setup.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { refuseShellUntilCreated } from '@/tests/mocks/setup-refusal'
import { confirmStepUp } from '@/tests/mocks/step-up'

const webauthn = vi.hoisted(() => ({ support: vi.fn(), create: vi.fn() }))

vi.mock('@/lib/webauthn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/webauthn')>()),
  passkeySupport: webauthn.support,
  createPasskeyCredential: webauthn.create,
  signalPasskeyUser: vi.fn(),
}))

const finish = vi.hoisted(() => ({ failWith: null as Error | null }))
const noted = vi.hoisted(() => vi.fn())

vi.mock('@/lib/passkey-setup', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/passkey-setup')>()
  return {
    ...original,
    finishPasskeySetup: (...args: Parameters<typeof original.finishPasskeySetup>) =>
      finish.failWith ? Promise.reject(finish.failWith) : original.finishPasskeySetup(...args),
  }
})

vi.mock('@/observability/errors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/observability/errors')>()),
  noteError: noted,
}))

const SETUP_MESSAGE = 'Create a passkey to continue. Every account here needs one.'
const PASSKEY = {
  id: 'pk-1',
  name: 'Passkey 1',
  provider: { name: 'iCloud Keychain', iconLight: null, iconDark: null },
  synced: true,
  createdAt: '2026-10-01T10:00:00.000Z',
  lastUsedAt: null,
  credentialId: 'cred-1',
}

/** Mounts the real route tree at `path`, as the app shell sees it. */
function renderAppAt(path: string): AnyRouter {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
    ...ROUTER_DEFAULTS,
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return router
}

/** The 403 required mode answers while the account has no passkey. */
function refusal() {
  return fail(SETUP_MESSAGE, 403, 'PASSKEY_SETUP_REQUIRED')
}

describe('the required-mode setup screen', () => {
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    usePasskeySetupStore.setState({ required: false, message: null })
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    webauthn.support.mockReset().mockResolvedValue({ create: true, autofill: true })
    webauthn.create.mockReset().mockResolvedValue({ id: 'new-cred' })
  })

  const realLocation = window.location

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
    vi.restoreAllMocks()
    usePasskeySetupStore.setState({ required: false, message: null })
  })

  it('AppShell renders the setup screen, not the layout, while the flag is set', async () => {
    usePasskeySetupStore.setState({ required: true, message: SETUP_MESSAGE })
    renderAppAt('/settings/account/profile')

    expect(
      await screen.findByRole('heading', { name: 'Create your passkey', level: 1 })
    ).toBeVisible()
    expect(screen.getByText(SETUP_MESSAGE)).toBeVisible()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible()
    await waitFor(() => expect(document.title).toBe(pageTitle('Create your passkey')))
  })

  it('returns to the page after create, with no reload (the lockout path through the email link)', async () => {
    const user = userEvent.setup()
    const state = { created: false }
    refuseShellUntilCreated(state)
    let optionsCalls = 0
    server.use(
      http.post('/api/v1/auth/passkeys/registration/options', () => {
        optionsCalls += 1
        // The first call finds the sign-in stale; the retry after the confirmation succeeds.
        if (optionsCalls === 1) return fail('Confirm it’s you.', 401, 'REAUTH_REQUIRED')
        return ok({ challengeId: 'c1', options: { challenge: 'x' } }, 'Options.')
      }),
      http.post('/api/v1/auth/step-up/link/request', () =>
        ok({ resendAvailableAt: new Date(Date.now() + 60_000).toISOString() }, 'Link sent.', 202)
      ),
      // Required mode: passkey step-up is not on the allowlist, and the account has no passkey.
      http.post('/api/v1/auth/passkeys/step-up/options', () => refusal()),
      http.post('/api/v1/auth/passkeys/registration/verify', () => {
        state.created = true
        return ok({ passkey: PASSKEY }, 'Passkey created.')
      })
    )
    const router = renderAppAt('/settings/account/profile')
    await screen.findByRole('heading', { name: 'Create your passkey', level: 1 })
    expect(usePasskeySetupStore.getState().required).toBe(true)
    const successToast = vi.spyOn(toast, 'success')

    await user.click(screen.getByRole('button', { name: 'Create a passkey' }))
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it’s you' })
    // The passkey view fell to the link view without an alert.
    expect(await within(dialog).findByRole('button', { name: 'Email me a link' })).toBeVisible()
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    await confirmStepUp(user, dialog)

    expect(await screen.findByRole('heading', { name: 'Profile', level: 1 })).toBeVisible()
    expect(usePasskeySetupStore.getState().required).toBe(false)
    expect(router.state.location.pathname).toBe('/settings/account/profile')
    expect(successToast).toHaveBeenCalledWith('Passkey created.')
    expect(screen.queryByRole('heading', { name: 'Create your passkey' })).not.toBeInTheDocument()
  })

  it('shows the unsupported line and Sign out without WebAuthn', async () => {
    webauthn.support.mockResolvedValue({ create: false, autofill: false })
    usePasskeySetupStore.setState({ required: true, message: SETUP_MESSAGE })
    renderAppAt('/settings/account/profile')

    expect(
      await screen.findByText(
        'This browser can’t create passkeys. Sign in on a current version of Chrome, Edge, Firefox or Safari to continue.'
      )
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Create a passkey' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled()
  })

  it('signs out from the setup screen', async () => {
    const user = userEvent.setup()
    const logout = vi.fn()
    server.use(
      http.post('/api/v1/auth/logout', () => {
        logout()
        return ok(null, 'Signed out.')
      })
    )
    const assign = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign },
    })
    usePasskeySetupStore.setState({ required: true, message: SETUP_MESSAGE })
    renderAppAt('/settings/account/profile')

    await user.click(await screen.findByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1))
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(assign).toHaveBeenCalledWith('/login')
  })

  it('toasts a failed create with the server message and stays on the screen', async () => {
    const user = userEvent.setup()
    const error = vi.spyOn(toast, 'error')
    server.use(
      http.post('/api/v1/auth/passkeys/registration/options', () =>
        fail('You have 20 passkeys.', 409, 'PASSKEY_LIMIT')
      )
    )
    usePasskeySetupStore.setState({ required: true, message: SETUP_MESSAGE })
    renderAppAt('/settings/account/profile')

    await user.click(await screen.findByRole('button', { name: 'Create a passkey' }))
    await waitFor(() => expect(error).toHaveBeenCalledWith('You have 20 passkeys.'))
    expect(usePasskeySetupStore.getState().required).toBe(true)
  })

  it('reports a failed refresh after create without a second toast or an unhandled rejection', async () => {
    const user = userEvent.setup()
    const boom = new Error('refresh failed')
    finish.failWith = boom
    noted.mockReset()
    const error = vi.spyOn(toast, 'error')
    const success = vi.spyOn(toast, 'success')
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      server.use(
        http.post('/api/v1/auth/passkeys/registration/options', () =>
          ok({ challengeId: 'c1', options: { challenge: 'x' } }, 'Options.')
        ),
        http.post('/api/v1/auth/passkeys/registration/verify', () =>
          ok({ passkey: PASSKEY }, 'Passkey created.')
        )
      )
      usePasskeySetupStore.setState({ required: true, message: SETUP_MESSAGE })
      renderAppAt('/settings/account/profile')

      await user.click(await screen.findByRole('button', { name: 'Create a passkey' }))
      await waitFor(() => expect(noted).toHaveBeenCalledWith(boom, 'rejection', true))
      expect(success).toHaveBeenCalledWith('Passkey created.')
      expect(error).not.toHaveBeenCalled()
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
      finish.failWith = null
    }
  })
})
