import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CreateTenantForm } from '@/components/features/tenant/create-tenant-form'
import { toast } from '@/lib/toast'
import type { Tenant } from '@/queries/tenant.queries'
import { queryClient } from '@/router'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { fail, ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { SLUG_TAKEN } from '@/types/api.types'

const TENANT: Tenant = {
  id: TENANT_ID,
  name: 'Acme Corp',
  slug: 'acme',
  description: null,
  logo: null,
  website: null,
  lifecycleState: 'active',
  deletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  isPlatform: false,
}

/** Renders the form alone, with `onCreated` as given. */
function renderForm(onCreated: (tenant: Tenant) => void | Promise<void> = () => {}) {
  render(
    <QueryClientProvider client={queryClient}>
      <CreateTenantForm submitLabel="Create tenant" busyLabel="Creating…" onCreated={onCreated} />
    </QueryClientProvider>
  )
}

describe('CreateTenantForm', () => {
  beforeEach(() => {
    queryClient.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects a mixed-case slug while typing rather than lowercasing it', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText('Slug'), 'MyOrg')
    // The slug is a routing identifier: silently rewriting "MyOrg" to "myorg" would address a different tenant than the one typed.
    expect(await screen.findByText(/must be lowercase letters/i)).toBeInTheDocument()
  })

  it('does not blame a field the user has not reached', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText('Slug'), 'a')
    // Live validation is scoped to the field being edited: running the whole schema on change would put "Name is required." under an untouched Name on the first slug keystroke.
    expect(screen.queryByText('Name is required.')).not.toBeInTheDocument()
    expect(await screen.findByText(/at least 3 characters/i)).toBeInTheDocument()
  })

  it('still refuses to submit without a name', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText('Slug'), 'acme')
    await user.click(screen.getByRole('button', { name: 'Create tenant' }))
    // The whole schema has the last word on submit, so an untouched field is still checked.
    expect(await screen.findByText('Name is required.')).toBeInTheDocument()
  })

  it('rejects a reserved slug while typing', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText('Slug'), 'admin')
    expect(await screen.findByText('This slug is reserved and cannot be used.')).toBeInTheDocument()
  })

  it('sends the parsed body', async () => {
    let posted: unknown = null
    server.use(
      http.post('/api/v1/tenants', async ({ request }) => {
        posted = await request.json()
        return ok(TENANT, 'Tenant created.', 201)
      })
    )
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText('Name'), '  Acme Corp  ')
    await user.type(screen.getByLabelText('Slug'), 'acme')
    await user.click(screen.getByRole('button', { name: 'Create tenant' }))

    await waitFor(() => {
      expect(posted).not.toBeNull()
    })
    // The schema trims, and the untouched description is absent rather than posted as '', which the API's `.min(1)` would refuse.
    expect(posted).toEqual({ name: 'Acme Corp', slug: 'acme' })
  })

  it('calls onCreated with the tenant, then resets', async () => {
    server.use(http.post('/api/v1/tenants', () => ok(TENANT, 'Tenant created.', 201)))
    let finish: (() => void) | undefined
    const onCreated = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const user = userEvent.setup()
    renderForm(onCreated)

    await user.type(screen.getByLabelText('Name'), 'Acme Corp')
    await user.type(screen.getByLabelText('Slug'), 'acme')
    await user.click(screen.getByRole('button', { name: 'Create tenant' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(TENANT))
    // The fields keep what was typed, and the button stays busy, until the caller is done with the tenant.
    expect(screen.getByLabelText('Name')).toHaveValue('Acme Corp')
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled()

    finish?.()
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue(''))
    expect(screen.getByLabelText('Slug')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Create tenant' })).toBeEnabled()
  })

  it('never shows the busy label for a submit that fails validation', async () => {
    const user = userEvent.setup()
    renderForm()
    const button = screen.getByRole('button', { name: 'Create tenant' })
    // Records every label the button shows, so a one-render flash is caught too.
    const labels: string[] = []
    const observer = new MutationObserver(() => labels.push(button.textContent))
    observer.observe(button, { childList: true, subtree: true, characterData: true })

    await user.type(screen.getByLabelText('Slug'), 'acme')
    await user.click(button)
    expect(await screen.findByText('Name is required.')).toBeInTheDocument()
    observer.disconnect()

    expect(labels.filter((label) => label.includes('Creating'))).toEqual([])
    expect(button).toHaveTextContent('Create tenant')
  })

  it('puts the server’s slug_taken under the slug field', async () => {
    server.use(
      http.post('/api/v1/tenants', () =>
        fail('Another workspace uses this slug. Choose a different one.', 409, SLUG_TAKEN)
      )
    )
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText('Name'), 'Acme Corp')
    await user.type(screen.getByLabelText('Slug'), 'acme')
    await user.click(screen.getByRole('button', { name: 'Create tenant' }))

    const slug = screen.getByLabelText('Slug')
    await waitFor(() => expect(slug).toHaveAttribute('aria-invalid', 'true'))
    expect(slug).toHaveAccessibleDescription(
      expect.stringContaining('Another workspace uses this slug. Choose a different one.')
    )
    expect(
      screen.getAllByText('Another workspace uses this slug. Choose a different one.')
    ).toHaveLength(1)
  })

  it('shows a refused create once, in the form, with no toast', async () => {
    const toastError = vi.spyOn(toast, 'error')
    server.use(http.post('/api/v1/tenants', () => fail('Something broke.', 500)))
    const onCreated = vi.fn()
    const user = userEvent.setup()
    renderForm(onCreated)

    await user.type(screen.getByLabelText('Name'), 'Acme Corp')
    await user.type(screen.getByLabelText('Slug'), 'acme')
    await user.click(screen.getByRole('button', { name: 'Create tenant' }))

    const message = await screen.findByText('Something broke.')
    expect(message.closest('form')).not.toBeNull()
    expect(screen.getAllByText('Something broke.')).toHaveLength(1)
    expect(toastError).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
  })
})
