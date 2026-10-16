import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MembershipRole } from '@/constants/roles'
import { resetSessionForTests } from '@/http/session'
import * as analytics from '@/observability/telemetry'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import {
  AUDIT_ID_1,
  AUDIT_ID_2,
  AUDIT_ID_3,
  AUDIT_ID_4,
  MEMBERSHIP_ID,
  STAFF_USER_ID,
  TENANT_ID,
  USER_ID,
  USER_ID_9,
} from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { fail, ok, tenantDetail, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { AuditEntry, TenantAccess } from '@/types/api.types'

const TENANT = {
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
}

const MEMBERS = [
  {
    membership: {
      id: MEMBERSHIP_ID,
      userId: USER_ID,
      tenantId: TENANT_ID,
      role: 'owner',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    user: { id: USER_ID, email: 'a@b.com', firstName: 'A', lastName: 'B' },
  },
]

/** An audit entry with the given fields over a member-access default, so a test sets only what it is about. */
function entry(
  fields: Pick<AuditEntry, 'id' | 'action' | 'metadata'> & Partial<AuditEntry>
): AuditEntry {
  return {
    occurredAt: '2026-09-25T09:00:00.000Z',
    access: 'member',
    actor: { id: USER_ID, name: 'A B', email: 'a@b.com' },
    target: null,
    ...fields,
  }
}

const CREATED = entry({
  id: AUDIT_ID_1,
  action: 'tenant.created',
  metadata: { name: 'Acme Corp', slug: 'acme' },
})
const STAFF_CHANGE = entry({
  id: AUDIT_ID_2,
  occurredAt: '2026-09-25T10:00:00.000Z',
  action: 'tenant.settings_updated',
  access: 'platform',
  actor: { id: STAFF_USER_ID, name: 'Sam Staff', email: 'sam@platform.test' },
  target: { type: 'settings', id: TENANT_ID },
  metadata: { changed: ['timezone'] },
})
// The API uses the email as the actor's name when no name is on file, so a nameless actor's `name` equals their `email` and is never `''`.
const OLDER = entry({
  id: AUDIT_ID_4,
  occurredAt: '2026-09-24T09:00:00.000Z',
  action: 'member.left',
  metadata: {},
})
const NAMELESS = entry({
  id: AUDIT_ID_3,
  occurredAt: '2026-09-25T11:00:00.000Z',
  action: 'invitation.created',
  actor: { id: USER_ID_9, name: 'nameless@b.com', email: 'nameless@b.com' },
  metadata: { role: 'viewer', emailDomain: 'b.com' },
})

/** Serves the acme tenant to `role` through `access`, with its member list. */
function mockTenant(role: MembershipRole, access: TenantAccess = 'member') {
  server.use(
    http.get('/api/v1/tenants/acme', () =>
      ok(tenantDetail(TENANT, role, access), 'Tenant retrieved.')
    ),
    http.get('/api/v1/tenants/acme/members', () => ok(listPage(MEMBERS), 'Members retrieved.'))
  )
}

/** One page of the audit log in the API's envelope; a `nextCursor` means more follow. */
function page(entries: AuditEntry[], nextCursor: string | null = null) {
  return ok(listPage(entries, { nextCursor, hasNext: nextCursor !== null }), 'Audit log retrieved.')
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

/** Mounts the real route tree at `path` and returns the router. */
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
  return router as AnyRouter
}

/** The activity row that says `text`. */
function rowFor(text: RegExp) {
  const item = screen.getByText(text).closest('tr')
  if (!item) throw new Error(`no activity row for ${String(text)}`)
  return within(item)
}

describe('tenant activity page', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

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
    renderAppAt('/settings/workspace/acme/activity')

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

  it('shows a nameless actor’s email once, not twice', async () => {
    mockTenant('owner')
    mockLog(() => page([NAMELESS]))
    renderAppAt('/settings/workspace/acme/activity')

    await screen.findByText('invited someone at b.com as Viewer')
    const row = rowFor(/invited someone at/)
    expect(row.getAllByText('nameless@b.com')).toHaveLength(1)
  })

  // The route is `requireRole('owner', 'admin')` on the effective role, so a staff admin passes.
  it('lets a staff admin read it under platform access', async () => {
    mockTenant('admin', 'platform')
    mockLog(() => page([CREATED]))
    renderAppAt('/settings/workspace/acme/activity')

    expect(await screen.findByText('created the tenant “Acme Corp”')).toBeInTheDocument()
  })

  it('says what the log holds once, in the page header, and keeps the card heading by role', async () => {
    mockTenant('owner')
    mockLog(() => page([CREATED]))
    renderAppAt('/settings/workspace/acme/activity')

    await screen.findByText('created the tenant “Acme Corp”')
    expect(screen.getAllByText('Every change made in this tenant, newest first.')).toHaveLength(1)
    expect(screen.getByText('What platform staff did is marked Staff.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Activity' })).toHaveClass('sr-only')
  })

  it('tells an editor it is for owners and admins, and never asks the API', async () => {
    mockTenant('editor')
    const seen = mockLog(() => page([]))
    renderAppAt('/settings/workspace/acme/activity')

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
    renderAppAt('/settings/workspace/acme/activity')

    // The log's own request is out, so the role skeleton is gone, and nothing has answered it.
    await waitFor(() => {
      expect(seen).toHaveLength(1)
    })
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull()
    expect(screen.queryByText('Nothing has happened in this tenant yet.')).not.toBeInTheDocument()
  })

  it('says nothing has happened yet when the log is empty', async () => {
    mockTenant('owner')
    mockLog(() => page([]))
    renderAppAt('/settings/workspace/acme/activity')

    expect(await screen.findByText('Nothing has happened in this tenant yet.')).toBeInTheDocument()
  })

  it('states the failure, not an empty log, and retries the log', async () => {
    mockTenant('owner')
    const seen = mockLog(() => fail('Something went wrong.', 500))
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/activity')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not load the activity/i)
    expect(screen.queryByText('Nothing has happened in this tenant yet.')).not.toBeInTheDocument()

    const before = seen.length
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    await waitFor(() => {
      expect(seen.length).toBeGreaterThan(before)
    })
  })

  it('lists the log in a table, newest first, with When, Actor, Action and Target', async () => {
    mockTenant('owner')
    mockLog(() => page([CREATED]))
    renderAppAt('/settings/workspace/acme/activity')
    const table = await screen.findByRole('table', { name: 'Activity' })
    for (const name of ['When', 'Actor', 'Action', 'Target']) {
      expect(within(table).getByRole('columnheader', { name })).toBeInTheDocument()
    }
    expect(within(table).getByRole('columnheader', { name: 'When' })).toHaveAttribute(
      'aria-sort',
      'descending'
    )
  })

  it('names what each entry acted on in the Target column', async () => {
    mockTenant('owner')
    mockLog(() => page([STAFF_CHANGE, CREATED]))
    renderAppAt('/settings/workspace/acme/activity')
    await screen.findByText(/changed the settings/)
    expect(rowFor(/changed the settings/).getByText('Settings')).toBeInTheDocument()
    expect(rowFor(/created the tenant/).getByText('—')).toBeInTheDocument()
  })

  it('pages with Next page, keeping the cursor in the URL', async () => {
    mockTenant('owner')
    mockLog((url) =>
      url.searchParams.get('cursor') === 'c2' ? page([OLDER]) : page([CREATED], 'c2')
    )
    const user = userEvent.setup()
    const router = renderAppAt('/settings/workspace/acme/activity')
    await screen.findByText(/created the tenant/)
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ cursor: 'c2' })
    })
    expect(await screen.findByText('left the tenant')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more activity' })).not.toBeInTheDocument()
  })

  it('filters by action through ?action=, sent as a comma list', async () => {
    mockTenant('owner')
    const seen = mockLog(() => page([CREATED]))
    const user = userEvent.setup()
    const router = renderAppAt('/settings/workspace/acme/activity')
    await screen.findByText(/created the tenant/)
    await user.click(screen.getByRole('button', { name: 'Filter by action' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by action' })
    await user.click(within(popup).getByRole('checkbox', { name: 'Settings changed' }))
    await user.click(within(popup).getByRole('checkbox', { name: 'Member removed' }))
    await waitFor(() => {
      expect(router.state.location.search).toEqual({
        action: 'member.removed,tenant.settings_updated',
      })
    })
    await waitFor(() => {
      expect(seen.at(-1)?.searchParams.get('action')).toBe('member.removed,tenant.settings_updated')
    })
  })

  it('offers no retired action in the Action facet', async () => {
    mockTenant('owner')
    mockLog(() => page([CREATED]))
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/activity')
    await screen.findByText(/created the tenant/)
    await user.click(screen.getByRole('button', { name: 'Filter by action' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by action' })
    expect(within(popup).getByRole('checkbox', { name: 'Settings changed' })).toBeInTheDocument()
    expect(
      within(popup).queryByRole('checkbox', { name: /errors viewed/i })
    ).not.toBeInTheDocument()
  })

  it('renders an entry recorded under a retired action with a readable label, without failing', async () => {
    mockTenant('owner')
    mockLog(() =>
      page([entry({ id: AUDIT_ID_4, action: 'tenant.errors_viewed', metadata: {} }), CREATED])
    )
    renderAppAt('/settings/workspace/acme/activity')
    expect(await screen.findByText('performed tenant errors viewed')).toBeInTheDocument()
    expect(screen.getByText(/created the tenant/)).toBeInTheDocument()
  })

  it('filters by who acted through ?actor=, one member at a time', async () => {
    mockTenant('owner')
    const seen = mockLog(() => page([CREATED]))
    const user = userEvent.setup()
    const router = renderAppAt('/settings/workspace/acme/activity')
    await screen.findByText(/created the tenant/)
    await user.click(screen.getByRole('button', { name: 'Filter by actor' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by actor' })
    await user.click(await within(popup).findByRole('checkbox', { name: 'A B' }))
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ actor: USER_ID })
    })
    await waitFor(() => {
      expect(seen.at(-1)?.searchParams.get('actor')).toBe(USER_ID)
    })
    expect(seen.at(-1)?.searchParams.has('actorUserId')).toBe(false)
    expect(
      await screen.findByRole('button', { name: /Remove filter: Actor: A B/ })
    ).toBeInTheDocument()
  })

  it('reads an actor outside the first hundred members as "A member" on its chip', async () => {
    mockTenant('owner')
    mockLog(() => page([CREATED]))
    renderAppAt(`/settings/workspace/acme/activity?actor=${USER_ID_9}`)
    expect(
      await screen.findByRole('button', { name: /Remove filter: Actor: A member/ })
    ).toBeInTheDocument()
  })

  it('shows the actor facet’s own load error, with a retry, while the log still lists', async () => {
    mockTenant('owner')
    let attempts = 0
    server.use(
      http.get('/api/v1/tenants/acme/members', () => {
        attempts += 1
        return attempts <= 2
          ? fail('Something went wrong', 500)
          : ok(listPage(MEMBERS), 'Members retrieved.')
      })
    )
    mockLog(() => page([CREATED]))
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/activity')
    await screen.findByText(/created the tenant/)
    await user.click(screen.getByRole('button', { name: 'Filter by actor' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by actor' })
    expect(await within(popup).findByText('Actor could not be loaded.')).toBeInTheDocument()
    await user.click(within(popup).getByRole('button', { name: 'Try again' }))
    expect(await within(popup).findByRole('checkbox', { name: 'A B' })).toBeInTheDocument()
  })

  it('shows only staff actions through ?access=platform', async () => {
    mockTenant('owner')
    const seen = mockLog(() => page([STAFF_CHANGE]))
    const user = userEvent.setup()
    const router = renderAppAt('/settings/workspace/acme/activity')
    await screen.findByText(/changed the settings/)
    await user.click(screen.getByRole('button', { name: 'Filter by access' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by access' })
    await user.click(within(popup).getByRole('checkbox', { name: 'Staff' }))
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ access: 'platform' })
    })
    await waitFor(() => {
      expect(seen.at(-1)?.searchParams.get('access')).toBe('platform')
    })
    expect(seen.at(-1)?.searchParams.has('actor')).toBe(false)
  })

  it('reports each filter change as table_filtered, naming the list and never the value', async () => {
    const track = vi.spyOn(analytics, 'track')
    mockTenant('owner')
    mockLog(() => page([CREATED]))
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/activity')
    await screen.findByText(/created the tenant/)
    expect(track).not.toHaveBeenCalledWith('table_filtered', expect.anything())

    await user.click(screen.getByRole('button', { name: 'Filter by action' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by action' })
    await user.click(within(popup).getByRole('checkbox', { name: 'Settings changed' }))
    await user.click(within(popup).getByRole('checkbox', { name: 'Member removed' }))

    const filtered = track.mock.calls.filter(([event]) => event === 'table_filtered')
    expect(filtered).toEqual([
      ['table_filtered', { table: 'activity' }],
      ['table_filtered', { table: 'activity' }],
    ])
  })

  it('says nothing matches, rather than nothing happened, under a filter', async () => {
    mockTenant('owner')
    mockLog((url) => page(url.searchParams.has('action') ? [] : [CREATED]))
    renderAppAt('/settings/workspace/acme/activity?action=tenant.created')

    expect(await screen.findByText('Nothing matches these filters.')).toBeInTheDocument()
    expect(screen.queryByText('Nothing has happened in this tenant yet.')).not.toBeInTheDocument()
  })

  // The route's role check passed on cached data, so a fresh 403 means the effective role changed on the server.
  it('says the tenant’s activity is owners-and-admins only when the log answers 403, and does not retry', async () => {
    mockTenant('owner')
    const seen = mockLog(() => fail('Forbidden', 403))
    renderAppAt('/settings/workspace/acme/activity')

    expect(
      await screen.findByText('Only this tenant’s owners and admins can see its activity.')
    ).toBeInTheDocument()
    expect(seen).toHaveLength(1)
  })

  /**
   * A 403 means the cached role is stale, so the page's gate (`useMyRole`, reading the same
   * `tenantKeys.detail` key) must refetch too, or the page keeps rendering on a role that no
   * longer holds.
   */
  it('invalidates the tenant detail when the log answers 403, so the page gate refreshes', async () => {
    let detailCalls = 0
    server.use(
      http.get('/api/v1/tenants/acme', () => {
        detailCalls += 1
        return ok(tenantDetail(TENANT, 'owner'), 'Tenant retrieved.')
      }),
      http.get('/api/v1/tenants/acme/members', () => ok(listPage(MEMBERS), 'Members retrieved.'))
    )
    mockLog(() => fail('Forbidden', 403))
    renderAppAt('/settings/workspace/acme/activity')
    await screen.findByText('Only this tenant’s owners and admins can see its activity.')

    // The initial load is one request, so a second means the invalidation fired, whether or not it landed before this text appeared.
    await waitFor(() => {
      expect(detailCalls).toBeGreaterThan(1)
    })
  })
})
