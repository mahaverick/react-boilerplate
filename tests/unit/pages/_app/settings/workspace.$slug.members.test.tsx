import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { MembershipRole } from '@/constants/roles'
import { resetSessionForTests } from '@/http/session'
import { formatDate } from '@/lib/format'
import { toast } from '@/lib/toast'
import { tenantKeys } from '@/queries/tenant.queries'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { testEntitlements } from '@/tests/fixtures/billing'
import {
  INVITATION_ID,
  INVITATION_ID_2,
  INVITATION_ID_3,
  INVITATION_ID_4,
  INVITATION_ID_5,
  INVITATION_ID_9,
  MEMBERSHIP_ID,
  MEMBERSHIP_ID_2,
  MEMBERSHIP_ID_3,
  MEMBERSHIP_ID_4,
  MEMBERSHIP_ID_5,
  TENANT_ID,
  USER_ID,
  USER_ID_2,
  USER_ID_3,
  USER_ID_4,
  USER_ID_5,
} from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import {
  fail,
  INVITATION_SENT_MESSAGE,
  ok,
  tenantDetail,
  testInvitation,
  testUser,
} from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { confirmStepUp, dismissStepUp } from '@/tests/mocks/step-up'
import { REAUTH_REQUIRED, type TenantInvitation } from '@/types/api.types'

afterEach(() => {
  vi.restoreAllMocks()
})

const TENANT = {
  id: TENANT_ID,
  name: 'Acme Corp',
  slug: 'acme',
  description: 'Anvils',
  logo: null,
  website: null,
  lifecycleState: 'active',
  deletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

/** Each fixture user's membership row. */
const MEMBERSHIP_OF: Readonly<Record<string, string>> = {
  [USER_ID]: MEMBERSHIP_ID,
  [USER_ID_2]: MEMBERSHIP_ID_2,
  [USER_ID_3]: MEMBERSHIP_ID_3,
  [USER_ID_4]: MEMBERSHIP_ID_4,
  [USER_ID_5]: MEMBERSHIP_ID_5,
}

/** One `{ membership, user }` row, as `listByTenant` returns it. */
function member(id: string, role: MembershipRole, firstName: string) {
  const membershipId = MEMBERSHIP_OF[id]
  if (membershipId === undefined) throw new Error(`no fixture membership for user ${id}`)
  return {
    membership: {
      id: membershipId,
      userId: id,
      tenantId: TENANT.id,
      role,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    user: { id, email: `${id}@b.com`, firstName, lastName: 'X' },
  }
}

/** `testUser.id` is `USER_ID`, so this is always "me". */
const ME = USER_ID

/** Serves the acme tenant, its list entry and its members, with the caller holding `myRole`. */
function mockTenant(myRole: MembershipRole, members: ReturnType<typeof member>[]) {
  server.use(
    http.get('/api/v1/tenants', () =>
      ok(
        listPage([
          { tenant: TENANT, role: myRole, isPlatform: false, joinedAt: '2026-01-01T00:00:00.000Z' },
        ]),
        'Tenants retrieved.'
      )
    ),
    http.get('/api/v1/tenants/acme', () => ok(tenantDetail(TENANT, myRole), 'Tenant retrieved.')),
    http.get('/api/v1/tenants/acme/members', () => ok(listPage(members), 'Members retrieved.'))
  )
}

/** `mockTenant` for the platform tenant, whose removals and leaves also revoke elsewhere. */
function mockPlatformTenant(myRole: MembershipRole, members: ReturnType<typeof member>[]) {
  const platform = { ...TENANT, name: 'Platform', slug: 'platform' }
  server.use(
    http.get('/api/v1/tenants', () =>
      ok(
        listPage([
          {
            tenant: platform,
            role: myRole,
            isPlatform: true,
            joinedAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
        'Tenants retrieved.'
      )
    ),
    http.get('/api/v1/tenants/platform', () =>
      ok(tenantDetail(platform, myRole), 'Tenant retrieved.')
    ),
    http.get('/api/v1/tenants/platform/members', () => ok(listPage(members), 'Members retrieved.'))
  )
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

/** The member table's row for one person, once the table has rendered. */
async function rowFor(name: string) {
  const cell = await screen.findByRole('cell', { name: new RegExp(name) })
  const row = cell.closest('tr')
  if (!row) throw new Error(`no row for ${name}`)
  return within(row)
}

/**
 * The caller's own Leave button, once it can be clicked: an owner's stays off
 * until the separate owners read has landed.
 */
async function enabledLeave() {
  const leave = (await rowFor('Me')).getByRole('button', { name: 'Leave' })
  await waitFor(() => expect(leave).toBeEnabled())
  return leave
}

/** Picks the viewport `useIsMobile` reports: the `matchMedia` stub in `tests/setup.ts` answers its `max-width` query from `window.innerWidth`. */
function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}
const realInnerWidth = window.innerWidth

describe('members page permissions', () => {
  afterEach(() => {
    setViewportWidth(realInnerWidth)
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

  it('lets an owner change and remove a non-owner', async () => {
    mockTenant('owner', [
      member(ME, 'owner', 'Me'),
      member(USER_ID_2, 'admin', 'Ada'),
      member(USER_ID_3, 'viewer', 'Vic'),
    ])
    renderAppAt('/settings/workspace/acme/members')

    const ada = await rowFor('Ada')
    expect(ada.getByRole('combobox', { name: 'Role for Ada X' })).toBeEnabled()
    expect(ada.getByRole('button', { name: 'Remove' })).toBeEnabled()

    const vic = await rowFor('Vic')
    expect(vic.getByRole('combobox', { name: 'Role for Vic X' })).toBeEnabled()
  })

  it('does not let an owner touch ANOTHER owner', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_4, 'owner', 'Otto')])
    renderAppAt('/settings/workspace/acme/members')

    const otto = await rowFor('Otto')
    // The matrix's one "self only" cell: an owner may act on an owner only when that owner is themselves.
    expect(otto.queryByRole('combobox')).not.toBeInTheDocument()
    expect(otto.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(otto.getByText('Owner')).toBeInTheDocument()
  })

  it('stops an ADMIN changing any role at all, a viewer’s included', async () => {
    mockTenant('admin', [
      member(ME, 'admin', 'Me'),
      member(USER_ID_3, 'viewer', 'Vic'),
      member(USER_ID_4, 'owner', 'Otto'),
      member(USER_ID_5, 'admin', 'Amy'),
    ])
    renderAppAt('/settings/workspace/acme/members')

    const vic = await rowFor('Vic')
    // Role change is owner-only (the route is gated `requireRole('owner')`) even though the matrix lets this admin remove the same viewer.
    expect(vic.queryByRole('combobox')).not.toBeInTheDocument()
    expect(vic.getByRole('button', { name: 'Remove' })).toBeEnabled()

    const otto = await rowFor('Otto')
    expect(otto.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()

    const amy = await rowFor('Amy')
    expect(amy.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()

    // Their own admin membership is never Remove, which the matrix refuses; it is Leave, which every role has.
    const me = await rowFor('Me')
    expect(me.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(me.getByRole('button', { name: 'Leave' })).toBeEnabled()
  })

  it('offers an admin only the roles below admin when inviting someone', async () => {
    mockTenant('admin', [member(ME, 'admin', 'Me')])
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.click(await screen.findByRole('combobox', { name: 'Role' }))
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent)
    // `canActorGrantRole`: an admin may grant anything except owner and admin.
    expect(options).toEqual(['Manager', 'Editor', 'Viewer'])
  })

  it('offers an owner every role when inviting someone', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_4, 'owner', 'Otto')])
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.click(await screen.findByRole('combobox', { name: 'Role' }))
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent)
    expect(options).toEqual(['Owner', 'Admin', 'Manager', 'Editor', 'Viewer'])
  })

  it('gives a viewer no controls but Leave, no invite form and no invitations request', async () => {
    let invitationCalls = 0
    mockTenant('viewer', [member(ME, 'viewer', 'Me'), member(USER_ID_3, 'viewer', 'Vic')])
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () => {
        invitationCalls += 1
        return ok(listPage([]), 'Invitations retrieved.')
      })
    )
    renderAppAt('/settings/workspace/acme/members')

    const vic = await rowFor('Vic')
    expect(vic.queryByRole('button', { name: /Remove|Leave/ })).not.toBeInTheDocument()
    expect((await rowFor('Me')).getByRole('button', { name: 'Leave' })).toBeEnabled()
    // Scoped to `main` because the sidebar's tenant switcher is a combobox on every authenticated page.
    const main = within(screen.getByRole('main'))
    expect(main.queryByRole('combobox', { name: /^Role for / })).not.toBeInTheDocument()
    expect(main.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(main.queryByRole('heading', { name: 'Invite a member' })).not.toBeInTheDocument()
    expect(main.queryByRole('heading', { name: 'Pending invitations' })).not.toBeInTheDocument()
    // The invitations list route is owner/admin only, so a viewer's page never asks for it.
    expect(invitationCalls).toBe(0)
  })

  it('disables the last owner’s own controls and says why', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_3, 'viewer', 'Vic')])
    renderAppAt('/settings/workspace/acme/members')

    const me = await rowFor('Me')
    // The backend answers 409 here, so the UI must not offer the action.
    expect(me.getByRole('combobox', { name: 'Role for Me X' })).toBeDisabled()
    expect(me.getByRole('button', { name: 'Leave' })).toBeDisabled()
    // Once per row, not once per disabled control: Leave points at the role cell's copy through aria-describedby instead of repeating the sentence.
    expect(
      me.getAllByText('A tenant must always have an owner. Add another owner first.')
    ).toHaveLength(1)
    const reason = me.getByText('A tenant must always have an owner. Add another owner first.')
    expect(me.getByRole('button', { name: 'Leave' })).toHaveAttribute('aria-describedby', reason.id)
    expect(me.getByRole('combobox', { name: 'Role for Me X' })).toHaveAttribute(
      'aria-describedby',
      reason.id
    )
  })

  it('re-enables them once a second owner exists', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_4, 'owner', 'Otto')])
    renderAppAt('/settings/workspace/acme/members')

    const me = await rowFor('Me')
    expect(me.getByRole('combobox', { name: 'Role for Me X' })).toBeEnabled()
    expect(me.getByRole('button', { name: 'Leave' })).toBeEnabled()
  })

  /**
   * At 390px the four-column table scrolls horizontally and puts the Actions column and the
   * last-owner explanation past the right edge. The card layout is one render path chosen in
   * JS, not a CSS `sm:hidden` pair, because two paths in the DOM would give two role selects
   * the same id.
   */
  it('stacks members as cards on a phone, so no control sits off-screen', async () => {
    setViewportWidth(390)
    mockTenant('owner', [member(ME, 'owner', 'A'), member(USER_ID_2, 'viewer', 'Cleo')])
    renderAppAt('/settings/workspace/acme/members')

    expect(await screen.findByText('Cleo X')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Role for Cleo X' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
  })

  it('keeps the "(you)" marker spaced from the name on a phone card', async () => {
    setViewportWidth(390)
    mockTenant('owner', [member(ME, 'owner', 'A'), member(USER_ID_2, 'viewer', 'Cleo')])
    renderAppAt('/settings/workspace/acme/members')

    const marker = await screen.findByText('(you)')
    expect(marker.parentElement).toHaveClass('flex', 'gap-2')
    expect(marker.parentElement).toHaveTextContent(/A.*\(you\)/)
    expect(screen.getAllByRole('listitem')).toContain(marker.closest('[role="listitem"]'))
  })

  /** A header row over nothing reads as missing data. The error branch above still runs first: `[]` means "no members" only once the request is known to have answered. */
  it('says the list is empty rather than showing a bare table header', async () => {
    mockTenant('owner', [])
    renderAppAt('/settings/workspace/acme/members')

    expect(await screen.findByText(/no one has access to this tenant yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('scrolls to the invite form and focuses its email field from the empty state', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      mockTenant('owner', [])
      renderAppAt('/settings/workspace/acme/members')

      await userEvent.click(await screen.findByRole('button', { name: 'Invite someone' }))

      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
      expect(screen.getByLabelText('Email')).toHaveFocus()
    } finally {
      // @ts-expect-error jsdom defines no scrollIntoView; removing the stub restores that.
      delete Element.prototype.scrollIntoView
    }
  })

  it('offers no invite action in the empty state to a role without the form', async () => {
    mockTenant('viewer', [])
    renderAppAt('/settings/workspace/acme/members')

    expect(await screen.findByText(/no one has access to this tenant yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Invite someone' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  })

  // The role comes from the tenant detail, not the tenant list, so a list failure (the switcher's problem) must not take the page's controls with it.
  it('keeps the role-gated controls when the tenant LIST fails', async () => {
    server.use(
      http.get('/api/v1/tenants', () => fail('Something went wrong.', 500)),
      http.get('/api/v1/tenants/acme', () =>
        ok(tenantDetail(TENANT, 'owner'), 'Tenant retrieved.')
      ),
      http.get('/api/v1/tenants/acme/members', () =>
        ok(
          listPage([member(ME, 'owner', 'Me'), member(USER_ID_3, 'viewer', 'Vic')]),
          'Members retrieved.'
        )
      )
    )
    renderAppAt('/settings/workspace/acme/members')

    const vic = await rowFor('Vic')
    expect(vic.getByRole('combobox', { name: 'Role for Vic X' })).toBeEnabled()
    expect(screen.queryByText(/couldn’t load your role/i)).not.toBeInTheDocument()
  })

  /**
   * The role's error state is reachable only through a failed refetch: a failed first load
   * is the layout's error boundary, so the page never mounts. A failed refetch keeps the
   * cached row and the layout, so the page has to say what it no longer knows instead of
   * showing a skeleton.
   */
  it('renders an error with a working retry when the role cannot be refreshed', async () => {
    let detailFails = false
    let detailCalls = 0
    server.use(
      http.get('/api/v1/tenants/acme', () => {
        detailCalls += 1
        return detailFails
          ? fail('Something went wrong.', 500)
          : ok(tenantDetail(TENANT, 'owner'), 'Tenant retrieved.')
      }),
      http.get('/api/v1/tenants/acme/members', () =>
        ok(
          listPage([member(ME, 'owner', 'Me'), member(USER_ID_4, 'owner', 'Otto')]),
          'Members retrieved.'
        )
      )
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')
    await screen.findByRole('combobox', { name: 'Role for Me X' })

    detailFails = true
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: tenantKeys.detail('acme'), exact: true })
    })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/couldn’t load your role/i)
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull()

    const before = detailCalls
    detailFails = false
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    // A new detail request, and the controls it gates come back with it.
    await waitFor(() => {
      expect(detailCalls).toBeGreaterThan(before)
    })
    expect(await screen.findByRole('combobox', { name: 'Role for Me X' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  /**
   * The retry must reach the query that failed, and the proof is a counted new request: the
   * members failure's retry refetches the members and leaves the tenant detail (the role's
   * source) untouched.
   */
  it('retries the MEMBER LIST, not the tenant detail, when the members are what failed', async () => {
    let memberCalls = 0
    let detailCalls = 0
    server.use(
      http.get('/api/v1/tenants/acme', () => {
        detailCalls += 1
        return ok(tenantDetail(TENANT, 'owner'), 'Tenant retrieved.')
      }),
      http.get('/api/v1/tenants/acme/members', ({ request }) => {
        // The owners read fails alike; only the table's own reads are counted.
        if (new URL(request.url).searchParams.get('role') !== 'owner') memberCalls += 1
        return fail('Something went wrong.', 500)
      })
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    const alert = await within(await screen.findByRole('region', { name: 'Members' })).findByRole(
      'alert'
    )
    expect(alert).toHaveTextContent(/couldn’t load this tenant’s members/i)
    expect(screen.queryByText(/couldn’t load your role/i)).not.toBeInTheDocument()

    await waitFor(() => {
      expect(memberCalls).toBe(2)
    })
    const membersBefore = memberCalls
    const detailBefore = detailCalls

    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    await waitFor(() => {
      expect(memberCalls).toBeGreaterThan(membersBefore)
    })
    expect(detailCalls).toBe(detailBefore)
  })

  it('shows the role failure in place of the list when the role lookup fails too, with its own retry', async () => {
    let detailFails = false
    server.use(
      http.get('/api/v1/tenants/acme', () =>
        detailFails
          ? fail('Something went wrong.', 500)
          : ok(tenantDetail(TENANT, 'owner'), 'Tenant retrieved.')
      ),
      http.get('/api/v1/tenants/acme/members', () => fail('Something went wrong.', 500))
    )
    renderAppAt('/settings/workspace/acme/members')
    const members = await screen.findByRole('region', { name: 'Members' })
    expect(await within(members).findByRole('alert')).toHaveTextContent(
      /couldn’t load this tenant’s members/i
    )

    detailFails = true
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: tenantKeys.detail('acme'), exact: true })
    })

    // Without a role the list's controls cannot be decided, so the role failure stands alone and its retry is the one that can fix the page.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/couldn’t load your role in this tenant/i)
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Members' })).not.toBeInTheDocument()
  })

  it('changes a role through the API and reports it', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_3, 'viewer', 'Vic')])
    let patched: unknown = null
    server.use(
      http.patch(`/api/v1/tenants/acme/members/${USER_ID_3}`, async ({ request }) => {
        patched = await request.json()
        return ok(member(USER_ID_3, 'editor', 'Vic').membership, 'Member role updated.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    const vic = await rowFor('Vic')
    await user.click(vic.getByRole('combobox', { name: 'Role for Vic X' }))
    await user.click(await screen.findByRole('option', { name: 'Editor' }))

    await waitFor(() => {
      expect(patched).toEqual({ role: 'editor' })
    })
  })
})

describe('the invite form role select', () => {
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_4, 'owner', 'Otto')])
  })

  it('points its label at the VISIBLE control, not at a hidden input', async () => {
    renderAppAt('/settings/workspace/acme/members')

    const trigger = await screen.findByRole('combobox', { name: 'Role' })
    const label = screen.getByText('Role', { selector: 'label' })
    // `FormControl`'s id lands on the Select's trigger button, so the label points at a visible control.
    expect(label).toHaveAttribute('for', trigger.id)
    expect(trigger.tagName).toBe('BUTTON')
  })

  it('clears the server’s verdict on the role when the select changes', async () => {
    server.use(
      // A field-level verdict on `role`, which is what the clearing rule is about; `fail()` carries no `errors` map, so it is built here.
      http.post('/api/v1/tenants/acme/invitations', () =>
        HttpResponse.json(
          {
            success: false,
            message: 'Check the highlighted fields, then try again.',
            statusCode: 400,
            errors: { role: ['That role is not yours to grant.'] },
            requestId: 'test-request-id',
          },
          { status: 400 }
        )
      )
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.type(await screen.findByLabelText('Email'), 'new@b.com')
    await user.click(screen.getByRole('button', { name: 'Invite member' }))
    await screen.findByText('That role is not yours to grant.')

    // Base UI's selection does not bubble a change event to the <form>, so <Form>'s clearing rule never fires here and the page calls clearField by hand; without that the message would stay while the user changed its field.
    await user.click(screen.getByRole('combobox', { name: 'Role' }))
    await user.click(await screen.findByRole('option', { name: 'Editor' }))

    await waitFor(() => {
      expect(screen.queryByText('That role is not yours to grant.')).not.toBeInTheDocument()
    })
  })
})

/** A pending row with its own id and address; everything else from `testInvitation`. */
function invitation(
  id: string,
  email: string,
  overrides: Partial<TenantInvitation> = {}
): TenantInvitation {
  return { ...testInvitation, id, email, ...overrides }
}

describe('inviting, and the pending invitations', () => {
  afterEach(() => {
    setViewportWidth(realInnerWidth)
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
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_3, 'viewer', 'Vic')])
  })

  it('sends an invitation, says so, and refreshes the pending list', async () => {
    let body: unknown
    let listCalls = 0
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () => {
        listCalls += 1
        return ok(
          listPage(
            listCalls === 1 ? [] : [invitation(INVITATION_ID_2, 'new@b.com', { role: 'viewer' })]
          ),
          'Invitations retrieved.'
        )
      }),
      http.post('/api/v1/tenants/acme/invitations', async ({ request }) => {
        body = await request.json()
        return ok(null, INVITATION_SENT_MESSAGE, 202)
      })
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.type(await screen.findByLabelText('Email'), 'New@B.com')
    await user.click(screen.getByRole('button', { name: 'Invite member' }))

    // The 202 is the same for every address, so the toast names what was sent.
    expect(await screen.findByText('Invitation sent to new@b.com.')).toBeInTheDocument()
    expect(body).toEqual({ email: 'new@b.com', role: 'viewer' })
    expect(await screen.findByText('new@b.com')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveValue('')
  })

  it('shows already_member on the email field, not in a toast', async () => {
    server.use(
      http.post('/api/v1/tenants/acme/invitations', () =>
        fail(
          'That person is already a member of this workspace. No invitation was sent.',
          409,
          'already_member'
        )
      )
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    const email = await screen.findByLabelText('Email')
    await user.type(email, 'u3@b.com')
    await user.click(screen.getByRole('button', { name: 'Invite member' }))

    await waitFor(() => {
      expect(email).toHaveAccessibleDescription(
        'That person is already a member of this workspace. No invitation was sent.'
      )
    })
    expect(email).toHaveAttribute('aria-invalid', 'true')
    // Inline only: a toast as well would say the same thing twice.
    expect(
      screen.getAllByText(
        'That person is already a member of this workspace. No invitation was sent.'
      )
    ).toHaveLength(1)

    await user.type(email, 'x')
    await waitFor(() => {
      expect(
        screen.queryByText(
          'That person is already a member of this workspace. No invitation was sent.'
        )
      ).not.toBeInTheDocument()
    })
  })

  it('says a racing invite won, and shows it in the refreshed list', async () => {
    const toastError = vi.spyOn(toast, 'error')
    let listCalls = 0
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () => {
        listCalls += 1
        return ok(
          listPage(listCalls === 1 ? [] : [invitation(INVITATION_ID_9, 'new@b.com')]),
          'Invitations retrieved.'
        )
      }),
      http.post('/api/v1/tenants/acme/invitations', () =>
        fail('An invitation for this address was just created.', 409, 'invitation_conflict')
      )
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.type(await screen.findByLabelText('Email'), 'new@b.com')
    await user.click(screen.getByRole('button', { name: 'Invite member' }))

    const raced = await screen.findByText(
      'Another member invited this address first. Their invitation is under Pending invitations.'
    )
    expect(raced.closest('form')).not.toBeNull()
    expect(toastError).not.toHaveBeenCalled()
    // The winning invitation arrives with the refetch.
    expect(await screen.findByText('new@b.com', { selector: 'span' })).toBeInTheDocument()
  })

  it('shows any other refusal in the form, once, and leaves the field alone', async () => {
    const toastError = vi.spyOn(toast, 'error')
    server.use(
      http.post('/api/v1/tenants/acme/invitations', () =>
        fail(
          "You've reached the limit of 10 attempts in 15 minutes. Try again in 15 minutes.",
          429,
          'RATE_LIMITED'
        )
      )
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    const email = await screen.findByLabelText('Email')
    await user.type(email, 'new@b.com')
    await user.click(screen.getByRole('button', { name: 'Invite member' }))

    const message = await screen.findByText(
      "You've reached the limit of 10 attempts in 15 minutes. Try again in 15 minutes."
    )
    expect(message.closest('form')).not.toBeNull()
    expect(
      screen.getAllByText(
        "You've reached the limit of 10 attempts in 15 minutes. Try again in 15 minutes."
      )
    ).toHaveLength(1)
    expect(toastError).not.toHaveBeenCalled()
    expect(email).toHaveAttribute('aria-invalid', 'false')
  })

  /** Serves one invitation by a named inviter and one whose inviter's account is gone. */
  function serveTwoInvitations() {
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok(
          listPage([
            testInvitation,
            invitation(INVITATION_ID_2, 'old@b.com', { role: 'viewer', invitedBy: null }),
          ]),
          'Invitations retrieved.'
        )
      )
    )
  }

  it('lists each pending invitation with its role, inviter and expiry', async () => {
    serveTwoInvitations()
    renderAppAt('/settings/workspace/acme/members')

    const table = await screen.findByRole('table', { name: 'Pending invitations' })
    const first = within((await within(table).findByText('invitee@b.com')).closest('tr')!)
    expect(first.getByText('Editor')).toBeInTheDocument()
    expect(first.getByText('A B')).toHaveClass('ph-sensitive', 'ph-mask')
    expect(first.getByText(/^by/)).toHaveTextContent('by A B')
    expect(first.getByText(formatDate(testInvitation.expiresAt, 'medium')!)).toBeInTheDocument()
    // An inviter whose account is gone is `null` and must not crash the row.
    const second = within(within(table).getByText('old@b.com').closest('tr')!)
    expect(second.getByText(/^by/)).toHaveTextContent('by A teammate')
  })

  it('names each list’s toolbar and paging controls apart, keeping the words they show', async () => {
    serveTwoInvitations()
    renderAppAt('/settings/workspace/acme/members?role=owner&invitationsRole=editor')

    await screen.findByRole('table', { name: 'Pending invitations' })
    const controls = screen
      .getAllByRole('button')
      .concat(screen.getAllByRole('combobox'))
      .map((control) => control.getAttribute('aria-label') ?? '')
      .filter((name) => /^(Filter by role|Columns|Reset|Rows per page)/.test(name))
    expect(controls).toEqual(
      expect.arrayContaining([
        'Filter by role, Members, 1 selected',
        'Filter by role, Pending invitations, 1 selected',
        'Columns, Members',
        'Columns, Pending invitations',
        'Reset, Members',
        'Reset, Pending invitations',
        'Rows per page, Members',
        'Rows per page, Pending invitations',
      ])
    )
    expect(new Set(controls).size).toBe(controls.length)
  })

  it('stacks pending invitations as cards on a phone, with role, inviter and expiry', async () => {
    setViewportWidth(390)
    serveTwoInvitations()
    renderAppAt('/settings/workspace/acme/members')

    expect(await screen.findByRole('heading', { name: 'Pending invitations' })).toBeInTheDocument()
    const first = within(
      (await screen.findByText('invitee@b.com')).closest('[role="listitem"]') as HTMLElement
    )
    expect(first.getByText(/^Editor · Invited by/)).toHaveTextContent('Editor · Invited by A B')
    expect(first.getByText('A B')).toHaveClass('ph-sensitive', 'ph-mask')
    expect(first.getByText(/^Expires /)).toBeInTheDocument()
    const second = within(screen.getByText('old@b.com').closest('[role="listitem"]') as HTMLElement)
    expect(second.getByText(/^Viewer · Invited by/)).toHaveTextContent(
      'Viewer · Invited by A teammate'
    )
  })

  it('says when nothing is pending', async () => {
    renderAppAt('/settings/workspace/acme/members')

    expect(
      await screen.findByText('No invitations are waiting to be accepted.')
    ).toBeInTheDocument()
  })

  it('offers a retry when the pending list fails, and the retry refetches it', async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () => {
        calls += 1
        // Two failures, because the router's client retries once by itself.
        return calls <= 2
          ? fail('Something went wrong.', 500)
          : ok(listPage([testInvitation]), 'Invitations retrieved.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/couldn’t load the pending invitations/i)
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('invitee@b.com')).toBeInTheDocument()
  })

  it('shows the section to an admin too', async () => {
    mockTenant('admin', [member(ME, 'admin', 'Me')])
    renderAppAt('/settings/workspace/acme/members')

    expect(await screen.findByRole('heading', { name: 'Pending invitations' })).toBeInTheDocument()
  })

  it('resends one invitation, says so, and refreshes the list', async () => {
    let resent: unknown
    let listCalls = 0
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () => {
        listCalls += 1
        return ok(listPage([testInvitation]), 'Invitations retrieved.')
      }),
      http.post('/api/v1/tenants/acme/invitations/:id/resend', ({ params }) => {
        resent = params.id
        return ok(null, INVITATION_SENT_MESSAGE, 202)
      })
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.click(
      await screen.findByRole('button', { name: 'Resend, invitation to invitee@b.com' })
    )

    expect(await screen.findByText('Invitation resent to invitee@b.com.')).toBeInTheDocument()
    expect(resent).toBe(INVITATION_ID)
    // The expiry moved, so the list is refetched.
    await waitFor(() => {
      expect(listCalls).toBeGreaterThan(1)
    })
  })

  it('shows the server’s message when a resend is refused, e.g. a 403', async () => {
    // The control is offered to an owner and the server refuses anyway: the server has the last word.
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok(
          listPage([invitation(INVITATION_ID, 'invitee@b.com', { role: 'owner' })]),
          'Invitations retrieved.'
        )
      ),
      http.post('/api/v1/tenants/acme/invitations/:id/resend', () =>
        fail('You cannot manage an invitation for that role.', 403)
      )
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.click(
      await screen.findByRole('button', { name: 'Resend, invitation to invitee@b.com' })
    )

    expect(
      await screen.findByText('You cannot manage an invitation for that role.')
    ).toBeInTheDocument()
  })

  it('switches off Resend and Revoke, with one reason, for a role an admin cannot grant', async () => {
    mockTenant('admin', [member(ME, 'admin', 'Me'), member(USER_ID_3, 'viewer', 'Vic')])
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok(
          listPage([
            invitation(INVITATION_ID, 'owner@b.com', { role: 'owner' }),
            invitation(INVITATION_ID_2, 'admin@b.com', { role: 'admin' }),
            invitation(INVITATION_ID_3, 'editor@b.com', { role: 'editor' }),
          ]),
          'Invitations retrieved.'
        )
      )
    )
    renderAppAt('/settings/workspace/acme/members')

    for (const email of ['owner@b.com', 'admin@b.com']) {
      const resend = await screen.findByRole('button', { name: `Resend, invitation to ${email}` })
      const revoke = screen.getByRole('button', { name: `Revoke invitation to ${email}` })
      for (const control of [resend, revoke]) {
        expect(control).toBeDisabled()
        expect(control).toHaveAccessibleDescription(
          'Only an owner can resend or revoke an invitation for this role.'
        )
      }
    }
    // Once per row, not once per disabled control.
    expect(
      screen.getAllByText('Only an owner can resend or revoke an invitation for this role.')
    ).toHaveLength(2)
    for (const name of [
      'Resend, invitation to editor@b.com',
      'Revoke invitation to editor@b.com',
    ]) {
      const control = screen.getByRole('button', { name })
      expect(control).toBeEnabled()
      expect(control).not.toHaveAttribute('aria-describedby')
    }
  })

  it('lets an owner resend and revoke an invitation for every role', async () => {
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok(
          listPage([
            invitation(INVITATION_ID, 'owner@b.com', { role: 'owner' }),
            invitation(INVITATION_ID_2, 'admin@b.com', { role: 'admin' }),
            invitation(INVITATION_ID_3, 'manager@b.com', { role: 'manager' }),
            invitation(INVITATION_ID_4, 'editor@b.com', { role: 'editor' }),
            invitation(INVITATION_ID_5, 'viewer@b.com', { role: 'viewer' }),
          ]),
          'Invitations retrieved.'
        )
      )
    )
    renderAppAt('/settings/workspace/acme/members')

    for (const role of ['owner', 'admin', 'manager', 'editor', 'viewer']) {
      const email = `${role}@b.com`
      const resend = await screen.findByRole('button', { name: `Resend, invitation to ${email}` })
      const revoke = screen.getByRole('button', { name: `Revoke invitation to ${email}` })
      for (const control of [resend, revoke]) {
        expect(control).toBeEnabled()
        expect(control).not.toHaveAttribute('aria-describedby')
      }
    }
    expect(
      screen.queryByText('Only an owner can resend or revoke an invitation for this role.')
    ).not.toBeInTheDocument()
  })

  it('says a resend found the invitation no longer pending, and refreshes the list', async () => {
    let listCalls = 0
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () => {
        listCalls += 1
        return ok(listPage(listCalls === 1 ? [testInvitation] : []), 'Invitations retrieved.')
      }),
      http.post('/api/v1/tenants/acme/invitations/:id/resend', () =>
        fail('Invitation not found.', 404, 'invitation_not_found')
      )
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.click(
      await screen.findByRole('button', { name: 'Resend, invitation to invitee@b.com' })
    )

    expect(await screen.findByText('That invitation is no longer pending.')).toBeInTheDocument()
    expect(
      await screen.findByText('No invitations are waiting to be accepted.')
    ).toBeInTheDocument()
  })

  it('asks before revoking, and Cancel sends nothing', async () => {
    let deletes = 0
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok(listPage([testInvitation]), 'Invitations retrieved.')
      ),
      http.delete('/api/v1/tenants/acme/invitations/:id', () => {
        deletes += 1
        return ok(null, 'Invitation revoked.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.click(
      await screen.findByRole('button', { name: 'Revoke invitation to invitee@b.com' })
    )
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAccessibleName('Revoke the invitation to invitee@b.com?')
    expect(dialog).toHaveAccessibleDescription(
      'The link in their email stops working immediately. You can invite them again from this page.'
    )
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(deletes).toBe(0)
    expect(screen.getByText('invitee@b.com')).toBeInTheDocument()
  })

  it('revokes on confirm, says so, and drops the row', async () => {
    let revoked: unknown
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok(listPage(revoked ? [] : [testInvitation]), 'Invitations retrieved.')
      ),
      http.delete('/api/v1/tenants/acme/invitations/:id', ({ params }) => {
        revoked = params.id
        return ok(null, 'Invitation revoked.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.click(
      await screen.findByRole('button', { name: 'Revoke invitation to invitee@b.com' })
    )
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }))

    // The toast still arrives although the refetch unmounts the row first.
    expect(await screen.findByText('Invitation to invitee@b.com revoked.')).toBeInTheDocument()
    expect(revoked).toBe(INVITATION_ID)
    expect(
      await screen.findByText('No invitations are waiting to be accepted.')
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
  })

  it('reports a revoke that lost the race, and refreshes the list', async () => {
    let listCalls = 0
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () => {
        listCalls += 1
        return ok(listPage(listCalls === 1 ? [testInvitation] : []), 'Invitations retrieved.')
      }),
      http.delete('/api/v1/tenants/acme/invitations/:id', () =>
        fail('Invitation not found.', 404, 'invitation_not_found')
      )
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.click(
      await screen.findByRole('button', { name: 'Revoke invitation to invitee@b.com' })
    )
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }))

    expect(await screen.findByText('That invitation is no longer pending.')).toBeInTheDocument()
    // Someone else revoked it or it was accepted, so the row goes either way.
    expect(
      await screen.findByText('No invitations are waiting to be accepted.')
    ).toBeInTheDocument()
  })
})

describe('the remove and leave dialogs', () => {
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

  it('tells an owner removing a member that the invitations that member sent are revoked', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_2, 'admin', 'Ada')])
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.click((await rowFor('Ada')).getByRole('button', { name: 'Remove' }))
    expect(await screen.findByRole('alertdialog')).toHaveAccessibleDescription(
      'Ada X will lose access to this tenant immediately. Pending invitations they sent are revoked.'
    )
  })

  it('tells an owner removing a platform member that their invitations in other tenants go too', async () => {
    mockPlatformTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_2, 'admin', 'Ada')])
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/platform/members')

    await user.click((await rowFor('Ada')).getByRole('button', { name: 'Remove' }))
    expect(await screen.findByRole('alertdialog')).toHaveAccessibleDescription(
      'Ada X loses staff access immediately. Pending invitations they sent here are revoked, and so are any they sent in other tenants for a role they can no longer grant there. If their address is on an auto-join domain, they rejoin as a viewer at their next sign-in.'
    )
  })

  it('tells a platform viewer leaving that an auto-join domain brings them back', async () => {
    mockPlatformTenant('viewer', [member(ME, 'viewer', 'Me'), member(USER_ID_4, 'owner', 'Otto')])
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/platform/members')

    await user.click(await enabledLeave())
    expect(await screen.findByRole('alertdialog')).toHaveAccessibleDescription(
      'You lose staff access immediately. An owner or admin will have to invite you back, unless your address is on an auto-join domain: then you rejoin as a viewer at your next sign-in.'
    )
  })

  it('tells a platform admin leaving that their invitations in other tenants go too', async () => {
    mockPlatformTenant('admin', [member(ME, 'admin', 'Me'), member(USER_ID_4, 'owner', 'Otto')])
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/platform/members')

    await user.click(await enabledLeave())
    expect(await screen.findByRole('alertdialog')).toHaveAccessibleDescription(
      'You lose staff access immediately. An owner or admin will have to invite you back, unless your address is on an auto-join domain: then you rejoin as a viewer at your next sign-in. Pending invitations you sent here are revoked, and so are any you sent in other tenants for a role you can no longer grant there.'
    )
  })

  it.each(['manager', 'editor', 'viewer'] as const)(
    'lets the %s leave through the membership route, then lands on the tenant list',
    async (role) => {
      let left = 0
      mockTenant(role, [member(ME, role, 'Me'), member(USER_ID_4, 'owner', 'Otto')])
      server.use(
        http.delete('/api/v1/tenants/acme/membership', () => {
          left += 1
          return ok(null, 'You left the tenant.')
        }),
        http.get('/api/v1/tenants', () => ok(listPage([]), 'Tenants retrieved.'))
      )
      const user = userEvent.setup()
      const router = renderAppAt('/settings/workspace/acme/members')

      await user.click(await enabledLeave())
      const dialog = await screen.findByRole('alertdialog')
      expect(dialog).toHaveAccessibleName('Leave this tenant?')
      expect(dialog).toHaveAccessibleDescription(
        'You will lose access to this tenant immediately. An owner or admin will have to invite you back.'
      )
      await user.click(within(dialog).getByRole('button', { name: 'Leave' }))

      expect(await screen.findByText('You left Acme Corp.')).toBeInTheDocument()
      expect(left).toBe(1)
      await waitFor(() => expect(router.state.location.pathname).toBe('/tenants'))
    }
  )

  it.each(['owner', 'admin'] as const)(
    'tells an %s leaving that the invitations they sent are revoked',
    async (role) => {
      mockTenant(role, [member(ME, role, 'Me'), member(USER_ID_4, 'owner', 'Otto')])
      const user = userEvent.setup()
      renderAppAt('/settings/workspace/acme/members')

      await user.click(await enabledLeave())
      expect(await screen.findByRole('alertdialog')).toHaveAccessibleDescription(
        'You will lose access to this tenant immediately. An owner or admin will have to invite you back. Pending invitations you sent are revoked.'
      )
    }
  )

  it('switches Leave off while the leave is in flight, so a second click sends nothing', async () => {
    let left = 0
    /** Lets the held leave request answer; replaced once `held` is created. */
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    mockTenant('viewer', [member(ME, 'viewer', 'Me'), member(USER_ID_4, 'owner', 'Otto')])
    server.use(
      http.delete('/api/v1/tenants/acme/membership', async () => {
        left += 1
        await held
        return ok(null, 'You left the tenant.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    const me = await rowFor('Me')
    await user.click(await enabledLeave())
    const confirm = within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'Leave',
    })
    await user.click(confirm)
    await waitFor(() => expect(confirm).toBeDisabled())
    expect(me.getByRole('button', { name: 'Leave', hidden: true })).toBeDisabled()
    await user.click(confirm)
    release()

    expect(await screen.findByText('You left Acme Corp.')).toBeInTheDocument()
    expect(left).toBe(1)
  })

  it('forgets the tenant it left without asking the API for it again', async () => {
    let hasLeft = false
    const afterLeaving: string[] = []
    /** Notes every request made after the leave answered. */
    const record = ({ request }: { request: Request }) => {
      if (hasLeft) afterLeaving.push(`${request.method} ${new URL(request.url).pathname}`)
    }
    mockTenant('viewer', [member(ME, 'viewer', 'Me'), member(USER_ID_4, 'owner', 'Otto')])
    server.use(
      http.delete('/api/v1/tenants/acme/membership', () => {
        hasLeft = true
        return ok(null, 'You left the tenant.')
      })
    )
    server.events.on('request:start', record)
    try {
      const user = userEvent.setup()
      const router = renderAppAt('/settings/workspace/acme/members')

      await user.click(await enabledLeave())
      await user.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' })
      )

      await waitFor(() => expect(router.state.location.pathname).toBe('/tenants'))
      await waitFor(() =>
        expect(queryClient.getQueryState(tenantKeys.detail('acme'))).toBeUndefined()
      )
      expect(afterLeaving).toContain('GET /api/v1/tenants')
      expect(afterLeaving.filter((entry) => entry.includes('/tenants/acme'))).toEqual([])
    } finally {
      server.events.removeListener('request:start', record)
    }
  })

  it('shows the refreshed member list after a refused leave', async () => {
    // Otto stops being an owner while the refused leave is in flight.
    let ottoRole: MembershipRole = 'owner'
    mockTenant('owner', [])
    server.use(
      http.get('/api/v1/tenants/acme/members', ({ request }) => {
        const rows = [member(ME, 'owner', 'Me'), member(USER_ID_4, ottoRole, 'Otto')]
        const owners = new URL(request.url).searchParams.get('role') === 'owner'
        return ok(
          listPage(owners ? rows.filter((row) => row.membership.role === 'owner') : rows),
          'Members retrieved.'
        )
      }),
      http.delete('/api/v1/tenants/acme/membership', () => {
        ottoRole = 'admin'
        return fail(
          "You're the last owner. Make someone else an owner before you leave.",
          409,
          'LAST_OWNER'
        )
      })
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.click(await enabledLeave())
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' })
    )

    await waitFor(async () =>
      expect((await rowFor('Me')).getByRole('button', { name: 'Leave' })).toBeDisabled()
    )
    expect((await rowFor('Me')).getByRole('button', { name: 'Leave' })).toHaveAccessibleDescription(
      'A tenant must always have an owner. Add another owner first.'
    )
  })

  it.each([
    ['no code', undefined],
    ['the tenant_not_found code', 'tenant_not_found'],
    ['the member_not_found code', 'member_not_found'],
  ])('lands on the tenant list when the membership was already gone (%s)', async (_label, code) => {
    mockTenant('viewer', [member(ME, 'viewer', 'Me'), member(USER_ID_4, 'owner', 'Otto')])
    server.use(
      http.delete('/api/v1/tenants/acme/membership', () => fail('Tenant not found', 404, code))
    )
    const user = userEvent.setup()
    const router = renderAppAt('/settings/workspace/acme/members')

    await user.click(await enabledLeave())
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' })
    )

    expect(await screen.findByText('You’re no longer a member of Acme Corp.')).toBeInTheDocument()
    expect(screen.queryByText('Tenant not found')).not.toBeInTheDocument()
    await waitFor(() => expect(router.state.location.pathname).toBe('/tenants'))
  })

  it('shows the server’s message when leaving is refused, and stays on the page', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_4, 'owner', 'Otto')])
    server.use(
      http.delete('/api/v1/tenants/acme/membership', () =>
        fail(
          "You're the last owner. Make someone else an owner before you leave.",
          409,
          'LAST_OWNER'
        )
      )
    )
    const user = userEvent.setup()
    const router = renderAppAt('/settings/workspace/acme/members')

    const me = await rowFor('Me')
    await user.click(await enabledLeave())
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' })
    )

    expect(
      await screen.findByText("You're the last owner. Make someone else an owner before you leave.")
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/settings/workspace/acme/members')
    expect(me.getByRole('button', { name: 'Leave' })).toBeEnabled()
  })
})

describe('a member who is already gone', () => {
  const GONE = 'That member is no longer in this tenant. We refreshed the list.'

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

  /** Serves a list holding Vic until the first write, then without; counts the list reads. */
  function serveVicThenNone() {
    const reads = { count: 0 }
    mockTenant('owner', [])
    server.use(
      http.get('/api/v1/tenants/acme/members', ({ request }) => {
        // The owners read is the last-owner rule's, not a read of the table.
        if (new URL(request.url).searchParams.get('role') === 'owner') {
          return ok(listPage([member(ME, 'owner', 'Me')]), 'Members retrieved.')
        }
        reads.count += 1
        const vic = reads.count === 1 ? [member(USER_ID_3, 'viewer', 'Vic')] : []
        return ok(listPage([member(ME, 'owner', 'Me'), ...vic]), 'Members retrieved.')
      })
    )
    return reads
  }

  it.each([
    ['the member_not_found code', () => fail('No such member here', 404, 'member_not_found')],
    ['the code with the old message', () => fail('Member not found', 404, 'member_not_found')],
  ])('says so and refreshes the list when a removal meets %s', async (_answer, answer) => {
    const reads = serveVicThenNone()
    server.use(http.delete(`/api/v1/tenants/acme/members/${USER_ID_3}`, answer))
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.click((await rowFor('Vic')).getByRole('button', { name: 'Remove' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' })
    )

    expect(await screen.findByText(GONE)).toBeInTheDocument()
    await waitFor(() => expect(reads.count).toBe(2))
    await waitFor(() => expect(screen.queryByRole('cell', { name: /Vic/ })).toBeNull())
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Members', level: 2 })).toHaveFocus()
    )
  })

  it.each([
    ['the member_not_found code', () => fail('No such member here', 404, 'member_not_found')],
    ['the code with the old message', () => fail('Member not found', 404, 'member_not_found')],
  ])('says so and refreshes the list when a role change meets %s', async (_answer, answer) => {
    const reads = serveVicThenNone()
    server.use(http.patch(`/api/v1/tenants/acme/members/${USER_ID_3}`, answer))
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.click((await rowFor('Vic')).getByRole('combobox', { name: 'Role for Vic X' }))
    await user.click(await screen.findByRole('option', { name: 'Editor' }))

    expect(await screen.findByText(GONE)).toBeInTheDocument()
    await waitFor(() => expect(reads.count).toBe(2))
    await waitFor(() => expect(screen.queryByRole('cell', { name: /Vic/ })).toBeNull())
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Members', level: 2 })).toHaveFocus()
    )
  })

  it('keeps the server’s message for any other 404, and does not refetch', async () => {
    const reads = serveVicThenNone()
    server.use(
      http.delete(`/api/v1/tenants/acme/members/${USER_ID_3}`, () => fail('Tenant not found', 404))
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.click((await rowFor('Vic')).getByRole('button', { name: 'Remove' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' })
    )

    expect(await screen.findByText('Tenant not found')).toBeInTheDocument()
    expect(screen.queryByText(GONE)).toBeNull()
    expect(reads.count).toBe(1)
  })

  it('reads only the code: the old message with no code is any other 404', async () => {
    serveVicThenNone()
    server.use(
      http.delete(`/api/v1/tenants/acme/members/${USER_ID_3}`, () => fail('Member not found', 404))
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.click((await rowFor('Vic')).getByRole('button', { name: 'Remove' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' })
    )

    expect(await screen.findByText('Member not found')).toBeInTheDocument()
    expect(screen.queryByText(GONE)).toBeNull()
  })
})

describe('the last owner, counted as the API counts', () => {
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

  /** A member row with the platform tenant's `active` flag. */
  function withActive(row: ReturnType<typeof member>, active: boolean) {
    return { ...row, user: { ...row.user, active } }
  }

  it('treats an inactive co-owner on the platform tenant as no owner at all', async () => {
    mockPlatformTenant('owner', [
      withActive(member(ME, 'owner', 'Me'), true),
      withActive(member(USER_ID_4, 'owner', 'Otto'), false),
    ])
    renderAppAt('/settings/workspace/platform/members')

    const me = await rowFor('Me')
    expect(me.getByRole('combobox', { name: 'Role for Me X' })).toBeDisabled()
    expect(me.getByRole('button', { name: 'Leave' })).toBeDisabled()
  })

  it('counts an active co-owner on the platform tenant', async () => {
    mockPlatformTenant('owner', [
      withActive(member(ME, 'owner', 'Me'), true),
      withActive(member(USER_ID_4, 'owner', 'Otto'), true),
    ])
    renderAppAt('/settings/workspace/platform/members')

    const me = await rowFor('Me')
    expect(me.getByRole('combobox', { name: 'Role for Me X' })).toBeEnabled()
    expect(me.getByRole('button', { name: 'Leave' })).toBeEnabled()
  })

  it('counts a platform co-owner whose row has no active flag, as an older API sends', async () => {
    mockPlatformTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_4, 'owner', 'Otto')])
    renderAppAt('/settings/workspace/platform/members')

    const me = await rowFor('Me')
    expect(me.getByRole('button', { name: 'Leave' })).toBeEnabled()
  })

  it('counts only the other owners on the platform tenant, whatever the leaver’s own flag', async () => {
    mockPlatformTenant('owner', [
      withActive(member(ME, 'owner', 'Me'), false),
      withActive(member(USER_ID_4, 'owner', 'Otto'), true),
    ])
    renderAppAt('/settings/workspace/platform/members')

    const me = await rowFor('Me')
    expect(me.getByRole('button', { name: 'Leave' })).toBeEnabled()
  })

  it('counts every owner on a customer tenant, an inactive one included', async () => {
    mockTenant('owner', [
      withActive(member(ME, 'owner', 'Me'), true),
      withActive(member(USER_ID_4, 'owner', 'Otto'), false),
    ])
    renderAppAt('/settings/workspace/acme/members')

    const me = await rowFor('Me')
    expect(me.getByRole('combobox', { name: 'Role for Me X' })).toBeEnabled()
    expect(me.getByRole('button', { name: 'Leave' })).toBeEnabled()
  })
})

describe('a customer tenant reached through platform access', () => {
  const STAFF_VIEW = 'You’re viewing this tenant as staff. Make changes from the staff console.'

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

  /** The tenant as staff reach it: an effective role through platform access, and no membership. */
  function mockStaffView(role: MembershipRole) {
    server.use(
      http.get('/api/v1/tenants', () => ok(listPage([]), 'Tenants retrieved.')),
      http.get('/api/v1/tenants/acme', () =>
        ok(tenantDetail(TENANT, role, 'platform'), 'Tenant retrieved.')
      ),
      http.get('/api/v1/tenants/acme/members', () =>
        ok(
          listPage([member(USER_ID_4, 'owner', 'Otto'), member(USER_ID_3, 'viewer', 'Vic')]),
          'Members retrieved.'
        )
      ),
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok(listPage([testInvitation]), 'Invitations retrieved.')
      )
    )
  }

  it.each(['owner', 'admin'] as const)(
    'shows a staff %s the members and pending invitations with no write control',
    async (role) => {
      mockStaffView(role)
      renderAppAt('/settings/workspace/acme/members')

      const vic = await rowFor('Vic')
      expect(screen.getByText(STAFF_VIEW)).toBeInTheDocument()
      expect(vic.getByText('Viewer')).toBeInTheDocument()
      expect(
        within(screen.getByRole('main')).queryByRole('combobox', { name: /^Role for / })
      ).toBeNull()
      expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
      expect(screen.queryByRole('heading', { name: 'Invite a member' })).toBeNull()
      expect(screen.queryByRole('textbox', { name: 'Email' })).toBeNull()
      expect(
        await screen.findByRole('heading', { name: 'Pending invitations' })
      ).toBeInTheDocument()
      expect(await screen.findByText('invitee@b.com')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Resend, invitation/ })).toBeNull()
      expect(screen.queryByRole('button', { name: /^Revoke invitation/ })).toBeNull()
      expect(screen.queryByRole('columnheader', { name: 'Actions' })).toBeNull()
      expect(
        within(vic.getByText('Viewer').closest('tr') as HTMLElement).getAllByRole('cell')
      ).toHaveLength(3)
    }
  )

  it('says nothing about the staff console to a staff viewer, who could not change members there either', async () => {
    mockStaffView('viewer')
    renderAppAt('/settings/workspace/acme/members')

    await rowFor('Vic')
    expect(screen.queryByText(STAFF_VIEW)).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).toBeNull()
  })

  it('keeps every control, and says nothing about staff, for a member', async () => {
    mockStaffView('owner')
    server.use(
      http.get('/api/v1/tenants/acme', () =>
        ok(tenantDetail(TENANT, 'owner', 'member'), 'Tenant retrieved.')
      ),
      http.get('/api/v1/tenants/acme/members', () =>
        ok(
          listPage([member(ME, 'owner', 'Me'), member(USER_ID_3, 'viewer', 'Vic')]),
          'Members retrieved.'
        )
      )
    )
    renderAppAt('/settings/workspace/acme/members')

    const vic = await rowFor('Vic')
    expect(vic.getByRole('combobox', { name: 'Role for Vic X' })).toBeEnabled()
    expect(vic.getByRole('button', { name: 'Remove' })).toBeEnabled()
    expect(screen.getByRole('heading', { name: 'Invite a member' })).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: 'Revoke invitation to invitee@b.com' })
    ).toBeInTheDocument()
    expect(screen.queryByText(STAFF_VIEW)).toBeNull()
    // One Actions column per list, members and invitations.
    expect(screen.getAllByRole('columnheader', { name: 'Actions' })).toHaveLength(2)
  })
})

describe('a stale sign-in on a member or invitation write', () => {
  const DISMISSED = 'Confirm it’s you to continue.'
  const NOT_CONFIRMED = 'We couldn’t confirm it’s you. Try the action again.'
  /** The refusal for a sign-in too old to change the platform tenant. */
  const stale = () => fail('Confirm it’s you to continue.', 401, REAUTH_REQUIRED)

  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_3, 'viewer', 'Vic')])
    server.use(
      http.post('/api/v1/auth/step-up/link/request', () =>
        ok({ resendAvailableAt: new Date(Date.now() + 60_000).toISOString() }, 'Sent.', 202)
      )
    )
  })

  it('asks to confirm, and says so when dismissed, if a role change is refused', async () => {
    server.use(http.patch(`/api/v1/tenants/acme/members/${USER_ID_3}`, stale))
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    const vic = await rowFor('Vic')
    await user.click(vic.getByRole('combobox', { name: 'Role for Vic X' }))
    await user.click(await screen.findByRole('option', { name: 'Editor' }))

    await dismissStepUp(user)
    expect(await screen.findByText(DISMISSED)).toBeInTheDocument()
  })

  it('asks to confirm, and says so when dismissed, if a removal is refused', async () => {
    server.use(http.delete(`/api/v1/tenants/acme/members/${USER_ID_3}`, stale))
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    const vic = await rowFor('Vic')
    await user.click(vic.getByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await dismissStepUp(user)
    expect(await screen.findByText(DISMISSED)).toBeInTheDocument()
  })

  it('asks to confirm, and says so when dismissed, if an invitation is refused', async () => {
    server.use(http.post('/api/v1/tenants/acme/invitations', stale))
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.type(await screen.findByLabelText('Email'), 'new@b.com')
    await user.click(screen.getByRole('button', { name: 'Invite member' }))

    await dismissStepUp(user)
    expect(await screen.findByText(DISMISSED)).toBeInTheDocument()
  })

  it('asks to confirm, and says so when dismissed, if leaving is refused', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_4, 'owner', 'Otto')])
    server.use(http.delete('/api/v1/tenants/acme/membership', stale))
    const user = userEvent.setup()
    const router = renderAppAt('/settings/workspace/acme/members')

    await user.click(await enabledLeave())
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }))

    await dismissStepUp(user)
    expect(await screen.findByText(DISMISSED)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/settings/workspace/acme/members')
  })

  it('asks to confirm, and says so when dismissed, if a resend is refused', async () => {
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok(
          listPage([invitation(INVITATION_ID, 'invitee@b.com', { role: 'admin' })]),
          'Invitations retrieved.'
        )
      ),
      http.post('/api/v1/tenants/acme/invitations/:id/resend', stale)
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.click(
      await screen.findByRole('button', { name: 'Resend, invitation to invitee@b.com' })
    )

    await dismissStepUp(user)
    expect(await screen.findByText(DISMISSED)).toBeInTheDocument()
  })

  it('retries the invitation once after the dialog confirms', async () => {
    let calls = 0
    server.use(
      http.post('/api/v1/tenants/acme/invitations', () => {
        calls += 1
        return calls === 1 ? stale() : ok(null, INVITATION_SENT_MESSAGE, 202)
      })
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.type(await screen.findByLabelText('Email'), 'new@b.com')
    await user.click(screen.getByRole('button', { name: 'Invite member' }))
    await confirmStepUp(user)

    expect(await screen.findByText('Invitation sent to new@b.com.')).toBeInTheDocument()
    expect(calls).toBe(2)
  })

  it('says the confirmation did not take when the retry is refused again', async () => {
    server.use(http.post('/api/v1/tenants/acme/invitations', stale))
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.type(await screen.findByLabelText('Email'), 'new@b.com')
    await user.click(screen.getByRole('button', { name: 'Invite member' }))
    await confirmStepUp(user)

    expect(await screen.findByText(NOT_CONFIRMED)).toBeInTheDocument()
  })
})

describe('keyboard focus after a row action succeeds', () => {
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

  it('lands on the Pending invitations heading when a revoke removes its row', async () => {
    let revoked = false
    mockTenant('owner', [member(ME, 'owner', 'Me')])
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok(listPage(revoked ? [] : [testInvitation]), 'Invitations retrieved.')
      ),
      http.delete('/api/v1/tenants/acme/invitations/:id', () => {
        revoked = true
        return ok(null, 'Invitation revoked.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.click(
      await screen.findByRole('button', { name: 'Revoke invitation to invitee@b.com' })
    )
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Revoke' })
    )

    await screen.findByText('No invitations are waiting to be accepted.')
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Pending invitations', level: 2 })).toHaveFocus()
    })
  })

  it('keeps focus off the heading when a revoke fails and the row stays', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me')])
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok(listPage([testInvitation]), 'Invitations retrieved.')
      ),
      http.delete('/api/v1/tenants/acme/invitations/:id', () =>
        fail('Something went wrong.', 500, 'internal_error')
      )
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.click(
      await screen.findByRole('button', { name: 'Revoke invitation to invitee@b.com' })
    )
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Revoke' })
    )

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(screen.getByRole('heading', { name: 'Pending invitations', level: 2 })).not.toHaveFocus()
    expect(screen.getByRole('button', { name: 'Revoke invitation to invitee@b.com' })).toHaveFocus()
  })

  it('lands on the Members heading when a removal takes the member’s row away', async () => {
    let removed = false
    const everyone = [member(ME, 'owner', 'Me'), member(USER_ID_3, 'viewer', 'Vic')]
    server.use(
      http.get('/api/v1/tenants', () =>
        ok(
          listPage([
            {
              tenant: TENANT,
              role: 'owner',
              isPlatform: false,
              joinedAt: '2026-01-01T00:00:00.000Z',
            },
          ]),
          'Tenants retrieved.'
        )
      ),
      http.get('/api/v1/tenants/acme', () =>
        ok(tenantDetail(TENANT, 'owner'), 'Tenant retrieved.')
      ),
      http.get('/api/v1/tenants/acme/members', () =>
        ok(listPage(removed ? everyone.slice(0, 1) : everyone), 'Members retrieved.')
      ),
      http.delete(`/api/v1/tenants/acme/members/${USER_ID_3}`, () => {
        removed = true
        return ok(null, 'Member removed.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    const vic = await rowFor('Vic')
    await user.click(vic.getByRole('button', { name: 'Remove' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' })
    )

    await waitFor(() => {
      expect(screen.queryByRole('cell', { name: /Vic/ })).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Members', level: 2 })).toHaveFocus()
    })
  })

  it('keeps focus on the Remove button when a removal fails and the row stays', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_3, 'viewer', 'Vic')])
    server.use(
      http.delete(`/api/v1/tenants/acme/members/${USER_ID_3}`, () =>
        fail('Something went wrong.', 500, 'internal_error')
      )
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    const vic = await rowFor('Vic')
    await user.click(vic.getByRole('button', { name: 'Remove' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' })
    )

    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(vic.getByRole('button', { name: 'Remove' })).toHaveFocus()
    expect(screen.getByRole('heading', { name: 'Members', level: 2 })).not.toHaveFocus()
  })

  it('does not move focus to the Members heading when you leave the tenant', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me'), member(USER_ID_3, 'owner', 'Vic')])
    server.use(
      http.delete('/api/v1/tenants/acme/membership', () => ok(null, 'You left the tenant.'))
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.click(await enabledLeave())
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' })
    )

    expect(await screen.findByText('You left Acme Corp.')).toBeInTheDocument()
    expect(document.activeElement?.tagName).not.toBe('H2')
  })
})

/** The last-owner explanation. */
const LAST_OWNER_TEXT = 'A tenant must always have an owner. Add another owner first.'

describe('the members list', () => {
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

  /** The caller as an owner, the row the last-owner rule reads. */
  const OWNER_ROW = member(ME, 'owner', 'Me')

  it('lists members in a table sorted by name, and sorts by email through ?sort=email', async () => {
    const seen: URLSearchParams[] = []
    mockTenant('owner', [OWNER_ROW, member(USER_ID_3, 'viewer', 'Vic')])
    server.use(
      http.get('/api/v1/tenants/acme/members', ({ request }) => {
        seen.push(new URL(request.url).searchParams)
        return ok(listPage([OWNER_ROW, member(USER_ID_3, 'viewer', 'Vic')]), 'Members retrieved.')
      })
    )
    const user = userEvent.setup()
    const router = renderAppAt('/settings/workspace/acme/members')
    const table = await screen.findByRole('table', { name: 'Members' })
    expect(within(table).getByRole('columnheader', { name: 'Name' })).toHaveAttribute(
      'aria-sort',
      'ascending'
    )
    await user.click(within(table).getByRole('button', { name: 'Email' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ sort: 'email' }))
    await waitFor(() => expect(seen.some((params) => params.get('sort') === 'email')).toBe(true))
  })

  it('shows a dash in Name for a member with no name, and the address once in Email', async () => {
    const nameless = member(USER_ID_3, 'viewer', '')
    nameless.user.lastName = ''
    mockTenant('owner', [OWNER_ROW, nameless])
    renderAppAt('/settings/workspace/acme/members')
    const table = await screen.findByRole('table', { name: 'Members' })
    const row = within(table).getByRole('row', { name: new RegExp(`${USER_ID_3}@b.com`) })
    expect(within(row).getByText('—')).toBeInTheDocument()
    expect(within(row).getAllByText(`${USER_ID_3}@b.com`)).toHaveLength(1)
  })

  it('counts an owner who is not on this page toward the last-owner rule', async () => {
    const other = member(USER_ID_4, 'owner', 'Otto')
    mockTenant('owner', [OWNER_ROW])
    server.use(
      http.get('/api/v1/tenants/acme/members', ({ request }) => {
        const params = new URL(request.url).searchParams
        // The page holds only the caller; the owners read finds the second owner.
        return params.get('role') === 'owner'
          ? ok(listPage([OWNER_ROW, other]), 'Members retrieved.')
          : ok(listPage([OWNER_ROW], { hasNext: true, nextCursor: 'c2' }), 'Members retrieved.')
      })
    )
    renderAppAt('/settings/workspace/acme/members')
    const leave = await screen.findByRole('button', { name: 'Leave' })
    await waitFor(() => expect(leave).toBeEnabled())
  })

  it('counts more owners than one read holds toward the last-owner rule', async () => {
    mockTenant('owner', [OWNER_ROW])
    server.use(
      http.get('/api/v1/tenants/acme/members', ({ request }) => {
        const params = new URL(request.url).searchParams
        // The owners read holds only the caller, and says more owners follow.
        return params.get('role') === 'owner'
          ? ok(listPage([OWNER_ROW], { hasNext: true, nextCursor: 'c2' }), 'Members retrieved.')
          : ok(listPage([OWNER_ROW]), 'Members retrieved.')
      })
    )
    renderAppAt('/settings/workspace/acme/members')
    const leave = await screen.findByRole('button', { name: 'Leave' })
    await waitFor(() => expect(leave).toBeEnabled())
  })

  it('says when the owners could not be loaded, and keeps the last owner locked', async () => {
    mockTenant('owner', [OWNER_ROW])
    server.use(
      http.get('/api/v1/tenants/acme/members', ({ request }) =>
        new URL(request.url).searchParams.get('role') === 'owner'
          ? fail('Something went wrong', 500)
          : ok(listPage([OWNER_ROW]), 'Members retrieved.')
      )
    )
    renderAppAt('/settings/workspace/acme/members')
    expect(
      await screen.findByText('Owners didn’t load, so owner changes are locked.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Leave' })).toBeDisabled()
    // Failed is not the same as one owner: the page does not claim the tenant has only one.
    expect(screen.queryByText(LAST_OWNER_TEXT)).not.toBeInTheDocument()
  })

  it('keeps the members search and the invitations search apart in the URL', async () => {
    mockTenant('owner', [OWNER_ROW])
    const user = userEvent.setup()
    const router = renderAppAt('/settings/workspace/acme/members')
    await screen.findByRole('table', { name: 'Members' })
    await user.type(screen.getByRole('searchbox', { name: 'Search members' }), 'cleo')
    await user.type(screen.getByRole('searchbox', { name: 'Search invitations' }), 'inv')
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ search: 'cleo', invitationsSearch: 'inv' })
    )
  })

  it('keeps the Role column, and the last owner’s reason, when ?hidden=role asks to hide it', async () => {
    mockTenant('owner', [OWNER_ROW])
    renderAppAt('/settings/workspace/acme/members?hidden=role')

    const members = await screen.findByRole('table', { name: 'Members' })
    expect(within(members).getByRole('columnheader', { name: 'Role' })).toBeInTheDocument()
    const reason = await within(members).findByText(LAST_OWNER_TEXT)
    const leave = within(members).getByRole('button', { name: 'Leave' })
    expect(leave).toBeDisabled()
    expect(leave).toHaveAttribute('aria-describedby', reason.id)
    expect(document.getElementById(reason.id)).toBe(reason)
  })

  it('offers no Role toggle in the Columns menu', async () => {
    mockTenant('owner', [OWNER_ROW])
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    const members = await screen.findByRole('region', { name: 'Members' })
    await user.click(await within(members).findByRole('button', { name: 'Columns, Members' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).queryByRole('menuitemcheckbox', { name: 'Role' })).not.toBeInTheDocument()
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Email' })).toBeInTheDocument()
  })

  it('locks the last owner’s controls without claiming a reason while the owners are loading', async () => {
    mockTenant('owner', [OWNER_ROW])
    server.use(
      http.get('/api/v1/tenants/acme/members', ({ request }) =>
        new URL(request.url).searchParams.get('role') === 'owner'
          ? new Promise<Response>(() => {})
          : ok(listPage([OWNER_ROW]), 'Members retrieved.')
      )
    )
    renderAppAt('/settings/workspace/acme/members')

    const leave = await screen.findByRole('button', { name: 'Leave' })
    expect(leave).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Role for Me X' })).toBeDisabled()
    expect(screen.queryByText(LAST_OWNER_TEXT)).not.toBeInTheDocument()
    expect(leave).not.toHaveAttribute('aria-describedby')
  })

  it.each(['admin', 'manager', 'editor', 'viewer'] as const)(
    'does not read the owners for %s, who cannot act on an owner row',
    async (role) => {
      const ownerReads: URLSearchParams[] = []
      mockTenant(role, [member(ME, role, 'Me'), member(USER_ID_4, 'owner', 'Otto')])
      server.use(
        http.get('/api/v1/tenants/acme/members', ({ request }) => {
          const params = new URL(request.url).searchParams
          if (params.get('role') === 'owner') ownerReads.push(params)
          return ok(
            listPage([member(ME, role, 'Me'), member(USER_ID_4, 'owner', 'Otto')]),
            'Members retrieved.'
          )
        })
      )
      renderAppAt('/settings/workspace/acme/members')

      await rowFor('Otto')
      expect(ownerReads).toEqual([])
    }
  )

  it('reads the owners for an owner, with no total', async () => {
    const ownerReads: URLSearchParams[] = []
    mockTenant('owner', [OWNER_ROW])
    server.use(
      http.get('/api/v1/tenants/acme/members', ({ request }) => {
        const params = new URL(request.url).searchParams
        if (params.get('role') === 'owner') ownerReads.push(params)
        return ok(listPage([OWNER_ROW]), 'Members retrieved.')
      })
    )
    renderAppAt('/settings/workspace/acme/members')

    await waitFor(() => expect(ownerReads).toHaveLength(1))
    expect(ownerReads[0]?.has('total')).toBe(false)
  })

  describe('two lists on one URL', () => {
    /** Serves one member and one invitation, so both tables render their headers. */
    function serveBoth() {
      mockTenant('owner', [OWNER_ROW, member(USER_ID_3, 'viewer', 'Vic')])
      server.use(
        http.get('/api/v1/tenants/acme/invitations', () =>
          ok(listPage([testInvitation]), 'Invitations retrieved.')
        )
      )
    }

    it('keeps the members cursor when the invitations list is sorted', async () => {
      serveBoth()
      const user = userEvent.setup()
      const router = renderAppAt(
        '/settings/workspace/acme/members?cursor=abc&invitationsCursor=xyz'
      )
      const table = await screen.findByRole('table', { name: 'Pending invitations' })
      await user.click(within(table).getByRole('button', { name: 'Email' }))
      await waitFor(() =>
        expect(router.state.location.search).toEqual({ cursor: 'abc', invitationsSort: 'email' })
      )
    })

    it('keeps the invitations cursor when the members list is sorted', async () => {
      serveBoth()
      const user = userEvent.setup()
      const router = renderAppAt(
        '/settings/workspace/acme/members?cursor=abc&invitationsCursor=xyz'
      )
      const table = await screen.findByRole('table', { name: 'Members' })
      await user.click(within(table).getByRole('button', { name: 'Email' }))
      await waitFor(() =>
        expect(router.state.location.search).toEqual({ sort: 'email', invitationsCursor: 'xyz' })
      )
    })
  })
})

describe('the members limit', () => {
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

  /** Serves Free-plan entitlements with `used` of `limit` members; the count of reads is returned. */
  function serveMembersUsage(used: number, limit: number | null = 3) {
    const reads = { count: 0 }
    server.use(
      http.get('/api/v1/tenants/acme/entitlements', () => {
        reads.count += 1
        return ok(
          testEntitlements({
            plan: { key: 'free', name: 'Free' },
            state: 'free',
            limits: { members: { limit, used, approaching: limit !== null && used >= limit - 1 } },
          }),
          'Entitlements retrieved.'
        )
      })
    )
    return reads
  }

  const AT_LIMIT = "You've used 3 of 3 members on Free. Upgrade to add more."
  const NOT_SENT = 'Not sent. You’re at the members limit.'

  it('shows the meter in the Members card, with no note below the limit', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me')])
    serveMembersUsage(2)
    renderAppAt('/settings/workspace/acme/members')

    expect(await screen.findByRole('meter', { name: 'Members' })).toHaveAttribute(
      'aria-valuetext',
      '2 of 3 members'
    )
    expect(screen.queryByText(AT_LIMIT)).toBeNull()
  })

  it('warns an owner at the limit, with an Upgrade link, and keeps the form enabled', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me')])
    serveMembersUsage(3)
    renderAppAt('/settings/workspace/acme/members')

    expect(await screen.findByText(AT_LIMIT)).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Upgrade' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Invite member' })).toBeEnabled()
    expect(screen.getByLabelText('Email')).toBeEnabled()
  })

  it('offers an admin at the limit Request upgrade, not a link', async () => {
    mockTenant('admin', [member(ME, 'admin', 'Me')])
    serveMembersUsage(3)
    renderAppAt('/settings/workspace/acme/members')

    expect(await screen.findByText(AT_LIMIT)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Request upgrade' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Upgrade' })).toBeNull()
  })

  it('says how many to remove when over the limit', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me')])
    serveMembersUsage(5)
    renderAppAt('/settings/workspace/acme/members')

    expect(
      await screen.findByText('5 of 3 members on Free. Upgrade to add more, or remove 2.')
    ).toBeInTheDocument()
  })

  it('shows no note and an unlimited meter on a plan with no limit', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me')])
    serveMembersUsage(7, null)
    renderAppAt('/settings/workspace/acme/members')

    expect(await screen.findByText('7 members · No limit')).toBeInTheDocument()
    expect(screen.queryByRole('meter')).toBeNull()
  })

  it('answers a 402 from the invite with a short form line, the counts left to the refetched note', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me')])
    // The page's count is stale (2); the server's is at the limit, as its refusal says.
    let used = 2
    const reads = { count: 0 }
    server.use(
      http.get('/api/v1/tenants/acme/entitlements', () => {
        reads.count += 1
        return ok(
          testEntitlements({
            plan: { key: 'free', name: 'Free' },
            state: 'free',
            limits: { members: { limit: 3, used, approaching: true } },
          }),
          'Entitlements retrieved.'
        )
      }),
      http.post('/api/v1/tenants/acme/invitations', () => {
        used = 3
        return fail('This workspace is at its member limit.', 402, 'PLAN_LIMIT_REACHED', {
          key: 'members',
          used: 3,
          limit: 3,
        })
      })
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.type(await screen.findByLabelText('Email'), 'new@b.com')
    const before = reads.count
    await user.click(screen.getByRole('button', { name: 'Invite member' }))

    await waitFor(() => {
      expect(reads.count).toBeGreaterThan(before)
    })
    // The note, with its Upgrade link, says the counts once; the form says only that it was not sent.
    expect(await screen.findByText(AT_LIMIT)).toBeInTheDocument()
    expect(screen.getAllByText(AT_LIMIT)).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Upgrade' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(NOT_SENT)
    expect(screen.queryByText('This workspace is at its member limit.')).toBeNull()
    expect(screen.getByLabelText('Email')).toHaveValue('new@b.com')
  })

  it('still shows another refusal of the invite in the form', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me')])
    serveMembersUsage(2)
    server.use(
      http.post('/api/v1/tenants/acme/invitations', () =>
        fail('Something went wrong on our side.', 500, 'INTERNAL_ERROR')
      )
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.type(await screen.findByLabelText('Email'), 'new@b.com')
    await user.click(screen.getByRole('button', { name: 'Invite member' }))

    expect(await screen.findByText('Something went wrong on our side.')).toBeInTheDocument()
  })

  it('says the invite was not sent when the note was already up before the click', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me')])
    serveMembersUsage(3)
    server.use(
      http.post('/api/v1/tenants/acme/invitations', () =>
        fail('This workspace is at its member limit.', 402, 'PLAN_LIMIT_REACHED', {
          key: 'members',
          used: 3,
          limit: 3,
        })
      )
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')
    expect(await screen.findByText(AT_LIMIT)).toBeInTheDocument()

    await user.type(screen.getByLabelText('Email'), 'new@b.com')
    await user.click(screen.getByRole('button', { name: 'Invite member' }))

    // The note does not change, so the form's alert is what tells the owner the click did something.
    expect(await screen.findByRole('alert')).toHaveTextContent(NOT_SENT)
    expect(screen.getAllByText(AT_LIMIT)).toHaveLength(1)
  })

  it('shows the server message for a 402 on another limit', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me')])
    serveMembersUsage(2)
    server.use(
      http.post('/api/v1/tenants/acme/invitations', () =>
        fail('This workspace has used all its projects.', 402, 'PLAN_LIMIT_REACHED', {
          key: 'projects',
          used: 5,
          limit: 5,
        })
      )
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.type(await screen.findByLabelText('Email'), 'new@b.com')
    await user.click(screen.getByRole('button', { name: 'Invite member' }))

    expect(await screen.findByText('This workspace has used all its projects.')).toBeInTheDocument()
    expect(screen.queryByText(NOT_SENT)).toBeNull()
  })

  it('shows the server message for a 402 that has no usage', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me')])
    serveMembersUsage(2)
    server.use(
      http.post('/api/v1/tenants/acme/invitations', () =>
        fail('Upgrade to add more members.', 402, 'PLAN_LIMIT_REACHED')
      )
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.type(await screen.findByLabelText('Email'), 'new@b.com')
    await user.click(screen.getByRole('button', { name: 'Invite member' }))

    expect(await screen.findByText('Upgrade to add more members.')).toBeInTheDocument()
  })

  it('toasts the short line, not the note’s counts, when a resend is refused for the limit', async () => {
    const toastError = vi.spyOn(toast, 'error')
    mockTenant('owner', [member(ME, 'owner', 'Me')])
    serveMembersUsage(3)
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok(listPage([testInvitation]), 'Invitations retrieved.')
      ),
      http.post('/api/v1/tenants/acme/invitations/:id/resend', () =>
        fail('This workspace is at its member limit.', 402, 'PLAN_LIMIT_REACHED', {
          key: 'members',
          used: 3,
          limit: 3,
        })
      )
    )
    const user = userEvent.setup()
    renderAppAt('/settings/workspace/acme/members')

    await user.click(
      await screen.findByRole('button', { name: 'Resend, invitation to invitee@b.com' })
    )

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(NOT_SENT)
    })
  })

  it('shows staff the meter but no action', async () => {
    server.use(
      http.get('/api/v1/tenants', () => ok(listPage([]), 'Tenants retrieved.')),
      http.get('/api/v1/tenants/acme', () =>
        ok(tenantDetail(TENANT, 'owner', 'platform'), 'Tenant retrieved.')
      ),
      http.get('/api/v1/tenants/acme/members', () =>
        ok(listPage([member(USER_ID_4, 'owner', 'Otto')]), 'Members retrieved.')
      ),
      http.get('/api/v1/tenants/acme/invitations', () => ok(listPage([]), 'Invitations retrieved.'))
    )
    serveMembersUsage(3)
    renderAppAt('/settings/workspace/acme/members')

    expect(await screen.findByRole('meter', { name: 'Members' })).toBeInTheDocument()
    expect(screen.queryByText(AT_LIMIT)).toBeNull()
    expect(screen.queryByRole('link', { name: 'Upgrade' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Request upgrade' })).toBeNull()
  })
})
