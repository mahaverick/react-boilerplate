import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { resetSessionForTests } from '@/http/session'
import { formatDate, formatDateTime } from '@/lib/format'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { testClientSettings } from '@/tests/fixtures/client-settings'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const REQUESTED_AT = '2026-11-01T09:30:00.000Z'
const DUE_AT = '2026-12-01T09:30:00.000Z'

/** Mounts the real route tree on Settings › Delete account. */
function renderDelete() {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ['/settings/account/delete'] }),
    ...ROUTER_DEFAULTS,
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
}

/** Selects Request deletion, then Send request in the confirmation dialog. */
async function requestAndConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Request deletion' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Ask us to delete your account?' })
  await user.click(within(dialog).getByRole('button', { name: 'Send request' }))
}

describe('delete account settings page', () => {
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
  })

  it('offers the request, a reason field and what we delete when nothing is open', async () => {
    renderDelete()

    expect(await screen.findByRole('heading', { level: 1, name: 'Delete account' })).toBeVisible()
    expect(
      await screen.findByText(
        'Ask us to delete your account. Our team deletes it within 30 days and emails you when it’s done.'
      )
    ).toBeVisible()
    expect(screen.getByLabelText('Why are you leaving?')).toHaveAttribute('maxlength', '500')
    expect(screen.getByRole('button', { name: 'Request deletion' })).toBeEnabled()
    expect(screen.getByRole('heading', { level: 3, name: 'What we delete' })).toBeVisible()
    const region = screen.getByRole('region', { name: 'Delete account' })
    expect(within(region).getByText(testUser.email)).toBeVisible()
  })

  it('says what we delete and keep, as express does it', async () => {
    renderDelete()

    const section = await screen.findByRole('region', { name: 'What we delete' })
    expect(section).toHaveTextContent(
      'Within 30 days of your request, we delete your account and sign you out everywhere. You can’t sign in to it again, and we remove its Google sign-in link.'
    )
    expect(section).toHaveTextContent(
      'When our staff purge your account, we permanently erase your name, your email address and the emails we sent you. We set no date for the purge. At the purge, we also ask our analytics provider to delete your profile, events and recordings.'
    )
    expect(section).toHaveTextContent(
      'We keep our audit log, which records actions taken in your account and workspaces. At the purge, entries for actions you took lose your user ID, IP address and browser details. Entries about your account keep the account’s ID. We keep audit entries with no end date, unless we set a retention period for the audit log.'
    )
    expect(section).toHaveTextContent(
      'We can’t delete your account while you’re the only owner of a workspace or you pay for a running subscription. Hand the workspace over first.'
    )
  })

  it('shows the open request’s dates instead of the button', async () => {
    server.use(
      http.get('/api/v1/account/deletion-request', () =>
        ok({ request: { requestedAt: REQUESTED_AT, dueAt: DUE_AT } })
      )
    )
    renderDelete()

    const requested = formatDate(REQUESTED_AT, 'long') ?? ''
    const due = formatDateTime(DUE_AT) ?? ''
    expect(
      await screen.findByText(
        `You asked us to delete your account on ${requested}. We’ll delete it by ${due}. To withdraw the request, write to ${testClientSettings.supportEmail} before then.`
      )
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Request deletion' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Why are you leaving?')).not.toBeInTheDocument()
  })

  it('requests deletion through step-up and then shows the due date', async () => {
    const bearers: string[] = []
    server.use(
      http.post('/api/v1/account/deletion-request', ({ request }) => {
        bearers.push(request.headers.get('authorization') ?? '')
        if (bearers.length === 1) {
          // Another confirmation lands while this request is in flight, so the step-up retries at once.
          useAuthStore.getState().setToken('newer-token')
          return fail("Confirm it's you to continue.", 401, 'REAUTH_REQUIRED')
        }
        return ok({ requestedAt: REQUESTED_AT, dueAt: DUE_AT }, 'We’ll delete your account.', 201)
      })
    )
    const user = userEvent.setup()
    renderDelete()

    await requestAndConfirm(user)

    const due = formatDateTime(DUE_AT) ?? ''
    expect(await screen.findByText(new RegExp(`We’ll delete it by ${due}`))).toBeVisible()
    expect(bearers).toEqual(['Bearer access-token', 'Bearer newer-token'])
    expect(screen.queryByRole('button', { name: 'Request deletion' })).not.toBeInTheDocument()
  })

  it('opens Confirm it’s you when the API wants a recent sign-in', async () => {
    server.use(
      http.post('/api/v1/account/deletion-request', () =>
        fail("Confirm it's you to continue.", 401, 'REAUTH_REQUIRED')
      )
    )
    const user = userEvent.setup()
    renderDelete()

    await requestAndConfirm(user)

    expect(await screen.findByRole('dialog', { name: 'Confirm it’s you' })).toBeVisible()
  })

  it('shows the server’s message and re-enables the button when express refuses with a 503', async () => {
    const message = 'We can’t take your request right now. Try again in a few minutes.'
    server.use(
      http.post('/api/v1/account/deletion-request', () => fail(message, 503, 'SERVICE_UNAVAILABLE'))
    )
    const user = userEvent.setup()
    renderDelete()

    await requestAndConfirm(user)

    expect(await screen.findByText(message)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Request deletion' })).toBeEnabled()
  })

  it('says the request was not confirmed when the step-up dialog is dismissed', async () => {
    server.use(
      http.post('/api/v1/account/deletion-request', () =>
        fail("Confirm it's you to continue.", 401, 'REAUTH_REQUIRED')
      )
    )
    const user = userEvent.setup()
    renderDelete()

    await requestAndConfirm(user)
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it’s you' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(
      await screen.findByText('Confirm it’s you to continue.', {
        selector: '[data-type="error"] *',
      })
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Request deletion' })).toBeEnabled()
  })

  it('hides the confirmation address once a request is open', async () => {
    server.use(
      http.get('/api/v1/account/deletion-request', () =>
        ok({ request: { requestedAt: REQUESTED_AT, dueAt: DUE_AT } })
      )
    )
    renderDelete()

    await screen.findByText(/We’ll delete it by/)
    expect(screen.queryByText(/We send the confirmation to/)).not.toBeInTheDocument()
  })

  it('sends the optional reason, trimmed, and none when it is blank', async () => {
    const bodies: unknown[] = []
    server.use(
      http.post('/api/v1/account/deletion-request', async ({ request }) => {
        bodies.push(await request.json())
        return ok({ requestedAt: REQUESTED_AT, dueAt: DUE_AT }, 'We’ll delete your account.', 201)
      })
    )
    const user = userEvent.setup()
    renderDelete()

    await user.type(await screen.findByLabelText('Why are you leaving?'), '  Too many emails  ')
    await requestAndConfirm(user)
    await screen.findByText(/We’ll delete it by/)

    expect(bodies).toEqual([{ reason: 'Too many emails' }])
  })

  it('sends no reason when the field is empty', async () => {
    const bodies: unknown[] = []
    server.use(
      http.post('/api/v1/account/deletion-request', async ({ request }) => {
        bodies.push(await request.json())
        return ok({ requestedAt: REQUESTED_AT, dueAt: DUE_AT }, 'We’ll delete your account.', 201)
      })
    )
    const user = userEvent.setup()
    renderDelete()

    await requestAndConfirm(user)
    await screen.findByText(/We’ll delete it by/)

    expect(bodies).toEqual([{}])
  })

  it('opens a confirmation first and posts nothing until it is confirmed', async () => {
    const bodies: unknown[] = []
    server.use(
      http.post('/api/v1/account/deletion-request', async ({ request }) => {
        bodies.push(await request.json())
        return ok({ requestedAt: REQUESTED_AT, dueAt: DUE_AT }, 'Done.', 201)
      })
    )
    const user = userEvent.setup()
    renderDelete()

    await user.click(await screen.findByRole('button', { name: 'Request deletion' }))
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Ask us to delete your account?',
    })
    expect(
      within(dialog).getByText(
        `Our team deletes it by the date in your receipt email, at most 30 days from now. You stay signed in until then. To withdraw the request, write to ${testClientSettings.supportEmail}.`
      )
    ).toBeVisible()
    expect(bodies).toEqual([])

    await user.click(within(dialog).getByRole('button', { name: 'Send request' }))
    await screen.findByText(/We’ll delete it by/)
    expect(bodies).toEqual([{}])
  })

  it('posts nothing when the confirmation is cancelled', async () => {
    const bodies: unknown[] = []
    server.use(
      http.post('/api/v1/account/deletion-request', async ({ request }) => {
        bodies.push(await request.json())
        return ok({ requestedAt: REQUESTED_AT, dueAt: DUE_AT }, 'Done.', 201)
      })
    )
    const user = userEvent.setup()
    renderDelete()

    await user.click(await screen.findByRole('button', { name: 'Request deletion' }))
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Ask us to delete your account?',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(bodies).toEqual([])
    expect(screen.getByRole('button', { name: 'Request deletion' })).toBeEnabled()
  })

  it('toasts the server’s own message for a new request', async () => {
    const message =
      'We’ll delete your account by 1 Dec 2026, 09:30 UTC. We are emailing you a receipt.'
    server.use(
      http.post('/api/v1/account/deletion-request', () =>
        ok({ requestedAt: REQUESTED_AT, dueAt: DUE_AT }, message, 201)
      )
    )
    const user = userEvent.setup()
    renderDelete()

    await requestAndConfirm(user)

    expect(await screen.findByText(message, { selector: '[data-type="success"] *' })).toBeVisible()
  })

  it('says the receipt came earlier when the request was already open (200)', async () => {
    server.use(
      http.post('/api/v1/account/deletion-request', () =>
        ok({ requestedAt: REQUESTED_AT, dueAt: DUE_AT }, '', 200)
      )
    )
    const user = userEvent.setup()
    renderDelete()

    await requestAndConfirm(user)

    expect(
      await screen.findByText(
        'You already asked us to delete your account. We sent the receipt then.',
        {
          selector: '[data-type="success"] *',
        }
      )
    ).toBeVisible()
  })

  it('tells a new request to check email when the response has no message (201)', async () => {
    server.use(
      http.post('/api/v1/account/deletion-request', () =>
        ok({ requestedAt: REQUESTED_AT, dueAt: DUE_AT }, '', 201)
      )
    )
    const user = userEvent.setup()
    renderDelete()

    await requestAndConfirm(user)

    expect(
      await screen.findByText('We’ve got your request. Check your email for a receipt.', {
        selector: '[data-type="success"] *',
      })
    ).toBeVisible()
  })
})
