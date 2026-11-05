import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { resetSessionForTests } from '@/http/session'
import { formatDate } from '@/lib/format'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
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

  it('shows the open request’s dates instead of the button', async () => {
    server.use(
      http.get('/api/v1/account/deletion-request', () =>
        ok({ request: { requestedAt: REQUESTED_AT, dueAt: DUE_AT } })
      )
    )
    renderDelete()

    const requested = formatDate(REQUESTED_AT, 'long') ?? ''
    const due = formatDate(DUE_AT, 'long') ?? ''
    expect(
      await screen.findByText(
        `You asked us to delete your account on ${requested}. We’ll delete it by ${due}.`
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

    await user.click(await screen.findByRole('button', { name: 'Request deletion' }))

    const due = formatDate(DUE_AT, 'long') ?? ''
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

    await user.click(await screen.findByRole('button', { name: 'Request deletion' }))

    expect(await screen.findByRole('dialog', { name: 'Confirm it’s you' })).toBeVisible()
  })

  it('shows the server’s message and re-enables the button when express refuses with a 409', async () => {
    const message =
      'This user is the last owner of Acme Corp. Make someone else an owner there first.'
    server.use(
      http.post('/api/v1/account/deletion-request', () => fail(message, 409, 'LAST_OWNER'))
    )
    const user = userEvent.setup()
    renderDelete()

    await user.click(await screen.findByRole('button', { name: 'Request deletion' }))

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

    await user.click(await screen.findByRole('button', { name: 'Request deletion' }))
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
    await user.click(screen.getByRole('button', { name: 'Request deletion' }))
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

    await user.click(await screen.findByRole('button', { name: 'Request deletion' }))
    await screen.findByText(/We’ll delete it by/)

    expect(bodies).toEqual([{}])
  })
})
