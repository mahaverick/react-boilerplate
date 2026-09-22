import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const TENANT = {
  id: 't1',
  name: 'Acme Corp',
  slug: 'acme',
  description: null,
  logo: null,
  website: null,
  lifecycleState: 'active',
  deletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function renderAppAt(path: string): AnyRouter {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return router as AnyRouter
}

describe('tenants list', () => {
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

  it('shows an empty state when the account belongs to no tenants', async () => {
    renderAppAt('/tenants')
    expect(await screen.findByText(/do not belong to any tenants/i)).toBeInTheDocument()
  })

  it('lists each tenant as a link carrying its role', async () => {
    server.use(
      http.get('/api/v1/tenants', () => ok([{ tenant: TENANT, role: 'admin' }], 'Tenants.'))
    )
    renderAppAt('/tenants')

    const link = await screen.findByRole('link', { name: /Acme Corp/ })
    expect(link).toHaveAttribute('href', '/tenants/acme')
    // The role in words, inside the row itself.
    expect(link).toHaveTextContent('Admin')
  })

  it('rejects a mixed-case slug while typing rather than lowercasing it', async () => {
    const user = userEvent.setup()
    renderAppAt('/tenants')

    await user.type(await screen.findByLabelText('Slug'), 'MyOrg')
    // The slug is a routing identifier: silently rewriting "MyOrg" to "myorg"
    // would address a different tenant than the one the user typed.
    expect(await screen.findByText(/must be lowercase letters/i)).toBeInTheDocument()
  })

  it('does not blame a field the user has not reached', async () => {
    const user = userEvent.setup()
    renderAppAt('/tenants')

    await user.type(await screen.findByLabelText('Slug'), 'a')
    // Live validation is scoped to the field being edited. Running the whole
    // schema on change put "Name is required." under an untouched Name as
    // soon as the first character of the slug was typed.
    expect(screen.queryByText('Name is required.')).not.toBeInTheDocument()
    // And the slug's own live feedback still works: 'a' is too short.
    expect(await screen.findByText(/at least 3 characters/i)).toBeInTheDocument()
  })

  it('still refuses to submit without a name', async () => {
    const user = userEvent.setup()
    renderAppAt('/tenants')

    await user.type(await screen.findByLabelText('Slug'), 'acme')
    await user.click(screen.getByRole('button', { name: 'Create tenant' }))
    // The whole schema still has the last word on submit — nothing escapes
    // by being untouched.
    expect(await screen.findByText('Name is required.')).toBeInTheDocument()
  })

  it('rejects a reserved slug while typing', async () => {
    const user = userEvent.setup()
    renderAppAt('/tenants')

    await user.type(await screen.findByLabelText('Slug'), 'admin')
    expect(await screen.findByText('This slug is reserved and cannot be used.')).toBeInTheDocument()
  })

  it('creates a tenant, sending the parsed body', async () => {
    let posted: unknown = null
    server.use(
      http.post('/api/v1/tenants', async ({ request }) => {
        posted = await request.json()
        return ok(TENANT, 'Tenant created.', 201)
      })
    )
    const user = userEvent.setup()
    renderAppAt('/tenants')

    await user.type(await screen.findByLabelText('Name'), '  Acme Corp  ')
    await user.type(screen.getByLabelText('Slug'), 'acme')
    await user.click(screen.getByRole('button', { name: 'Create tenant' }))

    await waitFor(() => {
      expect(posted).not.toBeNull()
    })
    // Trimmed by the schema, and the untouched description is ABSENT rather
    // than posted as '' — which the API's own `.min(1)` would refuse.
    expect(posted).toEqual({ name: 'Acme Corp', slug: 'acme' })
  })
})
