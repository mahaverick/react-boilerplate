import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import type { MembershipRole } from '@/constants/roles'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, tenantDetail, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { AuditEntry, TenantAccess } from '@/types/api.types'

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

const MEMBERS = [
  {
    membership: {
      id: 'm-u1',
      userId: 'u1',
      tenantId: 't1',
      role: 'owner',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    user: { id: 'u1', email: 'a@b.com', firstName: 'A', lastName: 'B' },
  },
]

function entry(
  fields: Pick<AuditEntry, 'id' | 'action' | 'metadata'> & Partial<AuditEntry>
): AuditEntry {
  return {
    occurredAt: '2026-09-25T09:00:00.000Z',
    access: 'member',
    actor: { id: 'u1', name: 'A B', email: 'a@b.com' },
    target: null,
    ...fields,
  }
}

const CREATED = entry({
  id: 'a1',
  action: 'tenant.created',
  metadata: { name: 'Acme Corp', slug: 'acme' },
})
const STAFF_CHANGE = entry({
  id: 'a2',
  occurredAt: '2026-09-25T10:00:00.000Z',
  action: 'tenant.settings_updated',
  access: 'platform',
  actor: { id: 's1', name: 'Sam Staff', email: 'sam@platform.test' },
  target: { type: 'settings', id: 't1' },
  metadata: { changed: ['timezone'] },
})

function mockTenant(role: MembershipRole, access: TenantAccess = 'member') {
  server.use(
    http.get('/api/v1/tenants/acme', () =>
      ok(tenantDetail(TENANT, role, access), 'Tenant retrieved.')
    ),
    http.get('/api/v1/tenants/acme/members', () => ok(MEMBERS, 'Members retrieved.'))
  )
}

function page(entries: AuditEntry[], nextCursor: string | null = null) {
  return ok({ entries, nextCursor }, 'Audit log retrieved.')
}

/** Every audit-log request, in order, answered by `respond`. */
function mockLog(respond: (url: URL) => Response | Promise<Response>) {
  const seen: URL[] = []
  server.use(
    http.get('/api/v1/tenants/acme/audit-log', ({ request }) => {
      const url = new URL(request.url)
      seen.push(url)
      return respond(url)
    })
  )
  return seen
}

function renderAppAt(path: string) {
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
}

/** The activity row that says `text`. */
function rowFor(text: RegExp) {
  const item = screen.getByText(text).closest('li')
  if (!item) throw new Error(`no activity row for ${String(text)}`)
  return within(item)
}

describe('tenant activity tab', () => {
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

  it('lists each entry as a sentence, and badges only what staff did', async () => {
    mockTenant('owner')
    mockLog(() => page([STAFF_CHANGE, CREATED]))
    renderAppAt('/tenants/acme/activity')

    expect(await screen.findByText('changed the settings (timezone)')).toBeInTheDocument()
    const staff = rowFor(/changed the settings/)
    expect(staff.getByText('Sam Staff')).toBeInTheDocument()
    expect(staff.getByText('sam@platform.test')).toBeInTheDocument()
    expect(staff.getByText('Staff')).toBeInTheDocument()

    const created = rowFor(/created the tenant/)
    expect(created.getByText('A B')).toBeInTheDocument()
    expect(created.queryByText('Staff')).not.toBeInTheDocument()
    // The machine-readable instant is on the element, whatever the words say.
    expect(document.querySelector('time[datetime="2026-09-25T09:00:00.000Z"]')).not.toBeNull()
  })

  // The route is `requireRole('owner', 'admin')` on the EFFECTIVE role.
  it('lets a staff admin read it under platform access', async () => {
    mockTenant('admin', 'platform')
    mockLog(() => page([CREATED]))
    renderAppAt('/tenants/acme/activity')

    expect(await screen.findByText('created the tenant “Acme Corp”')).toBeInTheDocument()
  })

  it('tells an editor it is for owners and admins, and never asks the API', async () => {
    mockTenant('editor')
    const seen = mockLog(() => page([]))
    renderAppAt('/tenants/acme/activity')

    expect(
      await screen.findByText('Only this tenant’s owners and admins can see its activity.')
    ).toBeInTheDocument()
    expect(seen).toHaveLength(0)
  })

  it('shows a skeleton while the first page is in flight', async () => {
    mockTenant('owner')
    const seen = mockLog(async () => {
      await delay('infinite')
      return page([])
    })
    renderAppAt('/tenants/acme/activity')

    // The log's own request is out (so the role skeleton is gone), and
    // nothing has answered it.
    await waitFor(() => {
      expect(seen).toHaveLength(1)
    })
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull()
    expect(screen.queryByText('Nothing has happened in this tenant yet.')).not.toBeInTheDocument()
  })

  it('says nothing has happened yet when the log is empty', async () => {
    mockTenant('owner')
    mockLog(() => page([]))
    renderAppAt('/tenants/acme/activity')

    expect(await screen.findByText('Nothing has happened in this tenant yet.')).toBeInTheDocument()
  })

  it('states the failure, not an empty log, and retries the log', async () => {
    mockTenant('owner')
    const seen = mockLog(() => fail('Something went wrong.', 500))
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/activity')

    const alert = await screen.findByRole('alert', {}, { timeout: 5000 })
    expect(alert).toHaveTextContent(/could not load the activity/i)
    expect(screen.queryByText('Nothing has happened in this tenant yet.')).not.toBeInTheDocument()

    const before = seen.length
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    await waitFor(() => {
      expect(seen.length).toBeGreaterThan(before)
    })
  })

  it('filters by action, on the server', async () => {
    mockTenant('owner')
    const seen = mockLog((url) =>
      page(
        url.searchParams.get('action') === 'tenant.settings_updated'
          ? [STAFF_CHANGE]
          : [STAFF_CHANGE, CREATED]
      )
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/activity')
    await screen.findByText(/created the tenant/)

    await user.click(screen.getByRole('combobox', { name: 'Filter by action' }))
    await user.click(await screen.findByRole('option', { name: 'Settings changed' }))

    await waitFor(() => {
      expect(seen.at(-1)?.searchParams.get('action')).toBe('tenant.settings_updated')
    })
    expect(await screen.findByText(/changed the settings/)).toBeInTheDocument()
    expect(screen.queryByText(/created the tenant/)).not.toBeInTheDocument()
  })

  it('says nothing matches, rather than nothing happened, under a filter', async () => {
    mockTenant('owner')
    mockLog((url) => page(url.searchParams.has('action') ? [] : [CREATED]))
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/activity')
    await screen.findByText(/created the tenant/)

    await user.click(screen.getByRole('combobox', { name: 'Filter by action' }))
    await user.click(await screen.findByRole('option', { name: 'Member removed' }))

    expect(await screen.findByText('Nothing matches these filters.')).toBeInTheDocument()
  })

  it('filters to staff by access, not by a user id', async () => {
    mockTenant('owner')
    const seen = mockLog(() => page([STAFF_CHANGE]))
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/activity')
    await screen.findByText(/changed the settings/)

    await user.click(screen.getByRole('combobox', { name: 'Filter by who acted' }))
    await user.click(await screen.findByRole('option', { name: 'Staff' }))

    await waitFor(() => {
      expect(seen.at(-1)?.searchParams.get('access')).toBe('platform')
    })
    expect(seen.at(-1)?.searchParams.has('actorUserId')).toBe(false)
  })

  it('filters by one of this tenant’s members', async () => {
    mockTenant('owner')
    const seen = mockLog(() => page([CREATED]))
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/activity')
    await screen.findByText(/created the tenant/)

    await user.click(screen.getByRole('combobox', { name: 'Filter by who acted' }))
    await user.click(await screen.findByRole('option', { name: 'A B' }))

    await waitFor(() => {
      expect(seen.at(-1)?.searchParams.get('actorUserId')).toBe('u1')
    })
    expect(seen.at(-1)?.searchParams.has('access')).toBe(false)
  })

  it('loads the next page from a Load more button', async () => {
    mockTenant('owner')
    const seen = mockLog((url) =>
      url.searchParams.get('cursor') === 'c2' ? page([CREATED]) : page([STAFF_CHANGE], 'c2')
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/activity')
    await screen.findByText(/changed the settings/)
    expect(screen.queryByText(/created the tenant/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Load more activity' }))

    expect(await screen.findByText(/created the tenant/)).toBeInTheDocument()
    expect(seen.at(-1)?.searchParams.get('cursor')).toBe('c2')
    expect(screen.queryByRole('button', { name: 'Load more activity' })).not.toBeInTheDocument()
  })

  // A failed NEXT page keeps what is already listed, and says so.
  it('keeps the loaded page when the next one fails, and says the list may be incomplete', async () => {
    mockTenant('owner')
    mockLog((url) =>
      url.searchParams.get('cursor') === 'c2'
        ? fail('Something went wrong.', 500)
        : page([STAFF_CHANGE], 'c2')
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/activity')
    await screen.findByText(/changed the settings/)

    await user.click(screen.getByRole('button', { name: 'Load more activity' }))

    const alert = await screen.findByRole('alert', {}, { timeout: 5000 })
    expect(alert).toHaveTextContent(/could not load more activity/i)
    expect(screen.getByText(/changed the settings/)).toBeInTheDocument()
  })
})
