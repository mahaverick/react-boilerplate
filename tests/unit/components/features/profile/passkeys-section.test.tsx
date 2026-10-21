import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PasskeysSection } from '@/components/features/profile/passkeys-section'
import { FRONTEND_APP } from '@/constants/frontend-app'
import { StepUpContext, type StepUp } from '@/hooks/use-step-up'
import { formatDate } from '@/lib/format'
import { isReauthRequired } from '@/lib/step-up'
import { toast } from '@/lib/toast'
import { track } from '@/observability/telemetry'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { PasskeyMode, PublicPasskey } from '@/types/passkey.types'

const webauthn = vi.hoisted(() => ({
  support: vi.fn(),
  create: vi.fn(),
  signalAccepted: vi.fn(),
  signalUser: vi.fn(),
}))

vi.mock('@/lib/webauthn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/webauthn')>()),
  passkeySupport: webauthn.support,
  createPasskeyCredential: webauthn.create,
  signalAcceptedPasskeys: webauthn.signalAccepted,
  signalPasskeyUser: webauthn.signalUser,
}))

vi.mock('@/observability/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/observability/telemetry')>()),
  track: vi.fn(),
}))

const CREATED_AT = '2026-10-01T10:00:00.000Z'
const LAST_USED_AT = '2026-10-05T10:00:00.000Z'

/** One passkey row as the API lists it. */
function makePasskey(index: number, overrides: Partial<PublicPasskey> = {}): PublicPasskey {
  return {
    id: `pk-${String(index)}`,
    name: `Passkey ${String(index)}`,
    provider: {
      name: 'iCloud Keychain',
      iconLight: 'data:image/png;base64,AA',
      iconDark: 'data:image/png;base64,BB',
    },
    synced: true,
    createdAt: CREATED_AT,
    lastUsedAt: null,
    credentialId: `cred-${String(index)}`,
    ...overrides,
  }
}

/** Serves the list (and the mode) the test needs. */
function mockList(passkeys: PublicPasskey[], mode: PasskeyMode = 'optional') {
  server.use(
    http.get('/api/v1/auth/passkeys/config', () =>
      ok({ mode, rpId: 'localhost' }, 'Passkey settings retrieved.')
    ),
    http.get('/api/v1/auth/passkeys', () =>
      ok({ passkeys, userHandle: 'HANDLE' }, 'Passkeys retrieved.')
    )
  )
}

/** The step-up runner the app shell provides, as a stub: a REAUTH_REQUIRED runs the action once more, as a confirmation would. */
const run: StepUp['run'] = async (action) => {
  try {
    return await action()
  } catch (error) {
    if (!isReauthRequired(error)) throw error
    return action()
  }
}

/** Renders the section; the config a test served sets the mode. */
function renderSection() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <StepUpContext.Provider value={{ run }}>
        <PasskeysSection />
      </StepUpContext.Provider>
    </QueryClientProvider>
  )
}

describe('PasskeysSection', () => {
  beforeEach(() => {
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    webauthn.support.mockReset().mockResolvedValue({ create: true, autofill: true })
    webauthn.create.mockReset().mockResolvedValue({ id: 'new-cred' })
    webauthn.signalAccepted.mockReset()
    webauthn.signalUser.mockReset()
    vi.mocked(track).mockClear()
    mockList([])
  })

  it('lists each passkey with its provider, Synced or This device only, and absolute dates', async () => {
    mockList([makePasskey(1), makePasskey(2, { synced: false, lastUsedAt: LAST_USED_AT })])
    renderSection()

    // The app formats in the reader's locale and zone, so the expectation does too.
    expect(await screen.findAllByText(`Created ${formatDate(CREATED_AT, 'medium')}`)).toHaveLength(
      2
    )
    expect(screen.getByText('Never used')).toBeVisible()
    expect(screen.getByText(`Last used ${formatDate(LAST_USED_AT, 'medium')}`)).toBeVisible()
    expect(screen.getByText('Synced')).toBeVisible()
    expect(screen.getByText('This device only')).toBeVisible()
    expect(screen.getAllByText('iCloud Keychain')).toHaveLength(2)
    expect(document.querySelectorAll('img[alt=""]')).toHaveLength(4)
  })

  it('draws a key icon when the provider has no icons', async () => {
    mockList([makePasskey(1, { provider: { name: 'Unknown', iconLight: null, iconDark: null } })])
    renderSection()

    await screen.findByText('Passkey 1')
    expect(document.querySelectorAll('img')).toHaveLength(0)
  })

  it('says there are none, and offers Create', async () => {
    renderSection()

    expect(await screen.findByText('You have no passkeys.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Create a passkey' })).toBeEnabled()
  })

  it('says it could not load the list, with Try again', async () => {
    server.use(http.get('/api/v1/auth/passkeys', () => fail('Down.', 500)))
    renderSection()

    expect(
      await screen.findByText('We couldn’t load your passkeys. Select Try again to load them.')
    ).toBeVisible()
  })

  it('Create runs Confirm it’s you on REAUTH_REQUIRED, then creates, toasts and signals the user details', async () => {
    const toastSuccess = vi.spyOn(toast, 'success')
    let optionCalls = 0
    server.use(
      http.post('/api/v1/auth/passkeys/registration/options', async ({ request }) => {
        optionCalls += 1
        expect(await request.json()).toEqual({ app: FRONTEND_APP })
        if (optionCalls === 1) return fail('Confirm it’s you.', 401, 'REAUTH_REQUIRED')
        return ok({ challengeId: 'c1', options: { challenge: 'x' } }, 'Options.')
      }),
      http.post('/api/v1/auth/passkeys/registration/verify', async ({ request }) => {
        expect(await request.json()).toEqual({
          challengeId: 'c1',
          response: { id: 'new-cred' },
          app: FRONTEND_APP,
        })
        return ok({ passkey: makePasskey(1, { name: 'MacBook' }) }, 'Created.')
      })
    )
    renderSection()

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Create a passkey' }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Passkey created.'))
    expect(optionCalls).toBe(2)
    expect(webauthn.signalUser).toHaveBeenCalledWith('localhost', testUser)
    expect(await screen.findByText('MacBook')).toBeVisible()
  })

  it('a cancelled create is quiet and tracked', async () => {
    const toastError = vi.spyOn(toast, 'error')
    server.use(
      http.post('/api/v1/auth/passkeys/registration/options', () =>
        ok({ challengeId: 'c1', options: {} }, 'Options.')
      )
    )
    webauthn.create.mockRejectedValue(new DOMException('no', 'NotAllowedError'))
    renderSection()

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Create a passkey' }))

    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('passkey_prompt_cancelled', { ceremony: 'create' })
    )
    expect(toastError).not.toHaveBeenCalled()
  })

  it('an already-registered device toasts PASSKEY_ALREADY_ON_DEVICE', async () => {
    const toastError = vi.spyOn(toast, 'error')
    server.use(
      http.post('/api/v1/auth/passkeys/registration/options', () =>
        ok({ challengeId: 'c1', options: {} }, 'Options.')
      )
    )
    webauthn.create.mockRejectedValue(new DOMException('dup', 'InvalidStateError'))
    renderSection()

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Create a passkey' }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'This device already holds a passkey for your account. Use that passkey, or create one on another device.'
      )
    )
  })

  it('a browser failure toasts PASSKEY_CREATE_FAILED', async () => {
    const toastError = vi.spyOn(toast, 'error')
    server.use(
      http.post('/api/v1/auth/passkeys/registration/options', () =>
        ok({ challengeId: 'c1', options: {} }, 'Options.')
      )
    )
    webauthn.create.mockRejectedValue(new Error('boom'))
    renderSection()

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Create a passkey' }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Your browser didn’t create a passkey. Try again, or use another device.'
      )
    )
  })

  it('a 409 PASSKEY_EXISTS toasts the server message as it arrives', async () => {
    const toastError = vi.spyOn(toast, 'error')
    server.use(
      http.post('/api/v1/auth/passkeys/registration/options', () =>
        ok({ challengeId: 'c1', options: {} }, 'Options.')
      ),
      http.post('/api/v1/auth/passkeys/registration/verify', () =>
        fail('You already have this passkey.', 409, 'PASSKEY_EXISTS')
      )
    )
    renderSection()

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Create a passkey' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('You already have this passkey.'))
  })

  it('disables Create at 20 passkeys with the limit hint', async () => {
    mockList(Array.from({ length: 20 }, (_, index) => makePasskey(index + 1)))
    renderSection()

    const create = await screen.findByRole('button', { name: 'Create a passkey' })
    await waitFor(() =>
      expect(create).toHaveAccessibleDescription(
        'You have 20 passkeys, the limit for one account. Delete one to create another.'
      )
    )
    expect(create).toBeDisabled()
  })

  it('shows PASSKEY_UNSUPPORTED instead of Create without WebAuthn, and the list still works', async () => {
    webauthn.support.mockResolvedValue({ create: false, autofill: false })
    mockList([makePasskey(1)])
    renderSection()

    expect(
      await screen.findByText(
        'This browser can’t create passkeys. Use a current version of Chrome, Edge, Firefox or Safari.'
      )
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Create a passkey' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rename Passkey 1' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete Passkey 1' })).toBeEnabled()
  })

  it('rename trims, refuses 65 characters, and toasts "Passkey renamed."', async () => {
    const toastSuccess = vi.spyOn(toast, 'success')
    let body: unknown
    mockList([makePasskey(1)])
    server.use(
      http.patch('/api/v1/auth/passkeys/pk-1', async ({ request }) => {
        body = await request.json()
        return ok({ passkey: makePasskey(1, { name: 'Work laptop' }) }, 'Renamed.')
      })
    )
    renderSection()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Rename Passkey 1' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Rename passkey' }))
    const input = dialog.getByLabelText('Name')
    expect(dialog.getByText('1 to 64 characters.')).toBeVisible()
    await user.clear(input)
    await user.type(input, 'a'.repeat(65))
    await user.click(dialog.getByRole('button', { name: 'Save' }))
    expect(await dialog.findByText('Enter a name of 1 to 64 characters.')).toBeVisible()
    expect(body).toBeUndefined()

    await user.clear(input)
    await user.type(input, '  Work laptop  ')
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Passkey renamed.'))
    expect(body).toEqual({ name: 'Work laptop' })
    expect(webauthn.signalUser).toHaveBeenCalledWith('localhost', testUser)
    expect(await screen.findByText('Work laptop')).toBeVisible()
  })

  it('delete confirms, sends the app param, toasts, and signals the remaining credential ids', async () => {
    const toastSuccess = vi.spyOn(toast, 'success')
    let query = ''
    mockList([makePasskey(1), makePasskey(2)])
    server.use(
      http.delete('/api/v1/auth/passkeys/pk-1', ({ request }) => {
        query = new URL(request.url).search
        return ok({ passkeys: [makePasskey(2)], userHandle: 'HANDLE' }, 'Deleted.')
      })
    )
    renderSection()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Delete Passkey 1' }))
    const dialog = within(await screen.findByRole('alertdialog', { name: 'Delete “Passkey 1”?' }))
    expect(
      dialog.getByText(
        'After you delete it, this passkey no longer signs you in or confirms it’s you.'
      )
    ).toBeVisible()
    await user.click(dialog.getByRole('button', { name: 'Delete passkey' }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Passkey deleted.'))
    expect(query).toBe(`?app=${FRONTEND_APP}`)
    expect(webauthn.signalAccepted).toHaveBeenCalledTimes(1)
    const [rpId, handle, remaining] = webauthn.signalAccepted.mock.calls[0] as [
      string,
      string,
      PublicPasskey[],
    ]
    expect([rpId, handle, remaining.map((p) => p.credentialId)]).toEqual([
      'localhost',
      'HANDLE',
      ['cred-2'],
    ])
    await waitFor(() => expect(screen.queryByText('Passkey 1')).not.toBeInTheDocument())
  })

  it('delete runs Confirm it’s you on REAUTH_REQUIRED', async () => {
    let calls = 0
    mockList([makePasskey(1), makePasskey(2)])
    server.use(
      http.delete('/api/v1/auth/passkeys/pk-1', () => {
        calls += 1
        if (calls === 1) return fail('Confirm it’s you.', 401, 'REAUTH_REQUIRED')
        return ok({ passkeys: [makePasskey(2)], userHandle: 'HANDLE' }, 'Deleted.')
      })
    )
    renderSection()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Delete Passkey 1' }))
    await user.click(await screen.findByRole('button', { name: 'Delete passkey' }))

    await waitFor(() => expect(calls).toBe(2))
  })

  it('warns with LAST_PASSKEY_WARNING on the only passkey in optional mode', async () => {
    mockList([makePasskey(1)])
    renderSection()

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Delete Passkey 1' }))

    expect(
      await screen.findByText(
        'This is your only passkey. You’ll sign in with an email link or Google until you create another.'
      )
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Delete passkey' })).toBeEnabled()
  })

  it('refuses the last passkey in required mode with only a Close button', async () => {
    mockList([makePasskey(1)], 'required')
    renderSection()

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Delete Passkey 1' }))

    const dialog = within(await screen.findByRole('alertdialog'))
    expect(
      dialog.getByText(
        'Create another passkey before you delete this one. Your account needs at least one.'
      )
    ).toBeVisible()
    expect(dialog.queryByRole('button', { name: 'Delete passkey' })).not.toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible()
  })

  it('toasts LAST_PASSKEY and refetches when the server refuses the delete', async () => {
    const toastError = vi.spyOn(toast, 'error')
    let lists = 0
    server.use(
      http.get('/api/v1/auth/passkeys', () => {
        lists += 1
        return ok(
          {
            passkeys: lists === 1 ? [makePasskey(1), makePasskey(2)] : [makePasskey(2)],
            userHandle: 'HANDLE',
          },
          'Passkeys retrieved.'
        )
      }),
      http.delete('/api/v1/auth/passkeys/pk-1', () =>
        fail('Create another passkey first.', 409, 'LAST_PASSKEY')
      )
    )
    renderSection()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Delete Passkey 1' }))
    await user.click(await screen.findByRole('button', { name: 'Delete passkey' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Create another passkey first.'))
    await waitFor(() => expect(lists).toBe(2))
    await waitFor(() => expect(screen.queryByText('Passkey 1')).not.toBeInTheDocument())
  })

  it('shows the light icon only in light and the dark icon only in dark', async () => {
    mockList([makePasskey(1)])
    renderSection()

    await screen.findByText('Passkey 1')
    const [light, dark] = Array.from(document.querySelectorAll('img'))
    expect(light?.getAttribute('src')).toBe('data:image/png;base64,AA')
    expect(light?.className.split(' ')).toEqual(expect.arrayContaining(['shrink-0', 'dark:hidden']))
    expect(dark?.className.split(' ')).toEqual(
      expect.arrayContaining(['shrink-0', 'hidden', 'dark:block'])
    )
  })

  it.each([
    ['PASSKEY_LIMIT', 409, 'You have 20 passkeys. Delete one to create another.'],
    ['EMAIL_UNVERIFIED', 403, 'Verify your email address to create a passkey.'],
  ])('a %s refusal on create toasts the server message', async (code, status, message) => {
    const toastError = vi.spyOn(toast, 'error')
    server.use(
      http.post('/api/v1/auth/passkeys/registration/options', () => fail(message, status, code))
    )
    renderSection()

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Create a passkey' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(message))
    expect(webauthn.create).not.toHaveBeenCalled()
  })

  it('refetches the list when a delete answers 404 passkey_not_found', async () => {
    const toastError = vi.spyOn(toast, 'error')
    let lists = 0
    server.use(
      http.get('/api/v1/auth/passkeys', () => {
        lists += 1
        return ok({ passkeys: [makePasskey(1), makePasskey(2)], userHandle: 'H' }, 'Passkeys.')
      }),
      http.delete('/api/v1/auth/passkeys/pk-1', () =>
        fail('Passkey not found.', 404, 'passkey_not_found')
      )
    )
    renderSection()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Delete Passkey 1' }))
    await user.click(await screen.findByRole('button', { name: 'Delete passkey' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Passkey not found.'))
    await waitFor(() => expect(lists).toBe(2))
  })

  it('refetches the list when a rename answers 404 passkey_not_found', async () => {
    let lists = 0
    server.use(
      http.get('/api/v1/auth/passkeys', () => {
        lists += 1
        return ok({ passkeys: [makePasskey(1)], userHandle: 'H' }, 'Passkeys.')
      }),
      http.patch('/api/v1/auth/passkeys/pk-1', () =>
        fail('Passkey not found.', 404, 'passkey_not_found')
      )
    )
    renderSection()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Rename Passkey 1' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Rename passkey' }))
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(lists).toBe(2))
  })
})
