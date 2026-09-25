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
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MembershipRole } from '@/constants/roles'
import { resetSessionForTests } from '@/http/session'
import { tenantKeys } from '@/queries/tenant.queries'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, tenantDetail, testInvitation, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { TenantInvitation } from '@/types/api.types'

const TENANT = {
  id: 't1',
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

/** One `{ membership, user }` row, as `listByTenant` returns it. */
function member(id: string, role: MembershipRole, firstName: string) {
  return {
    membership: {
      id: `m-${id}`,
      userId: id,
      tenantId: TENANT.id,
      role,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    user: { id, email: `${id}@b.com`, firstName, lastName: 'X' },
  }
}

/** `testUser` is `u1`, so this is always "me". */
const ME = 'u1'

function mockTenant(myRole: MembershipRole, members: ReturnType<typeof member>[]) {
  server.use(
    http.get('/api/v1/tenants', () => ok([{ tenant: TENANT, role: myRole }], 'Tenants retrieved.')),
    http.get('/api/v1/tenants/acme', () => ok(tenantDetail(TENANT, myRole), 'Tenant retrieved.')),
    http.get('/api/v1/tenants/acme/members', () => ok(members, 'Members retrieved.'))
  )
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

/** The member table's row for one person, once the table has rendered. */
async function rowFor(name: string) {
  const cell = await screen.findByRole('cell', { name: new RegExp(name) })
  const row = cell.closest('tr')
  if (!row) throw new Error(`no row for ${name}`)
  return within(row)
}

/**
 * `useIsMobile` reads `window.innerWidth` for the VALUE and only uses
 * matchMedia for the listener, so setting the width is what decides.
 */
function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}
const realInnerWidth = window.innerWidth

describe('members tab permissions', () => {
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
      member('u2', 'admin', 'Ada'),
      member('u3', 'viewer', 'Vic'),
    ])
    renderAppAt('/tenants/acme/members')

    const ada = await rowFor('Ada')
    expect(ada.getByRole('combobox', { name: 'Role for Ada X' })).toBeEnabled()
    expect(ada.getByRole('button', { name: 'Remove' })).toBeEnabled()

    const vic = await rowFor('Vic')
    expect(vic.getByRole('combobox', { name: 'Role for Vic X' })).toBeEnabled()
  })

  it('does not let an owner touch ANOTHER owner', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me'), member('u4', 'owner', 'Otto')])
    renderAppAt('/tenants/acme/members')

    const otto = await rowFor('Otto')
    // The matrix's one "self only" cell: an owner may act on an owner only
    // when that owner is themselves.
    expect(otto.queryByRole('combobox')).not.toBeInTheDocument()
    expect(otto.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(otto.getByText('Owner')).toBeInTheDocument()
  })

  it('stops an ADMIN changing any role at all, a viewer’s included', async () => {
    mockTenant('admin', [
      member(ME, 'admin', 'Me'),
      member('u3', 'viewer', 'Vic'),
      member('u4', 'owner', 'Otto'),
      member('u5', 'admin', 'Amy'),
    ])
    renderAppAt('/tenants/acme/members')

    const vic = await rowFor('Vic')
    // Role CHANGE is owner-only — the route is gated requireRole('owner') —
    // even though the matrix lets this admin REMOVE the same viewer.
    expect(vic.queryByRole('combobox')).not.toBeInTheDocument()
    expect(vic.getByRole('button', { name: 'Remove' })).toBeEnabled()

    const otto = await rowFor('Otto')
    expect(otto.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()

    const amy = await rowFor('Amy')
    expect(amy.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()

    // Not even their own admin membership: the matrix answers "no" for an
    // admin target however `isSelf` reads.
    const me = await rowFor('Me')
    expect(me.queryByRole('button', { name: /Remove|Leave/ })).not.toBeInTheDocument()
  })

  it('offers an admin only the roles below admin when inviting someone', async () => {
    mockTenant('admin', [member(ME, 'admin', 'Me')])
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/members')

    await user.click(await screen.findByRole('combobox', { name: 'Role' }))
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent)
    // canActorGrantRole: an admin may grant anything EXCEPT owner and admin.
    expect(options).toEqual(['Manager', 'Editor', 'Viewer'])
  })

  it('offers an owner every role when inviting someone', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me'), member('u4', 'owner', 'Otto')])
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/members')

    await user.click(await screen.findByRole('combobox', { name: 'Role' }))
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent)
    expect(options).toEqual(['Owner', 'Admin', 'Manager', 'Editor', 'Viewer'])
  })

  it('gives a viewer no controls, no invite form and no invitations request', async () => {
    let invitationCalls = 0
    mockTenant('viewer', [member(ME, 'viewer', 'Me'), member('u3', 'viewer', 'Vic')])
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () => {
        invitationCalls += 1
        return ok([], 'Invitations retrieved.')
      })
    )
    renderAppAt('/tenants/acme/members')

    await rowFor('Vic')
    // Scoped to `main`: the sidebar's tenant switcher is a combobox too, on
    // every authenticated page, and is not what this test is about.
    const main = within(screen.getByRole('main'))
    expect(main.queryByRole('combobox')).not.toBeInTheDocument()
    expect(main.queryByRole('button', { name: /Remove|Leave/ })).not.toBeInTheDocument()
    expect(main.queryByRole('heading', { name: 'Invite a member' })).not.toBeInTheDocument()
    expect(main.queryByRole('heading', { name: 'Pending invitations' })).not.toBeInTheDocument()
    // The list route is owner/admin only, so a viewer's page never asks it.
    expect(invitationCalls).toBe(0)
  })

  it('disables the last owner’s own controls and says why', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me'), member('u3', 'viewer', 'Vic')])
    renderAppAt('/tenants/acme/members')

    const me = await rowFor('Me')
    // The backend answers 409 here. The UI must not invite that error.
    expect(me.getByRole('combobox', { name: 'Role for Me X' })).toBeDisabled()
    expect(me.getByRole('button', { name: 'Leave' })).toBeDisabled()
    // ONCE per row, not once per disabled control: the Leave button points at
    // the role cell's copy through aria-describedby rather than repeating the
    // same sentence underneath itself.
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
    mockTenant('owner', [member(ME, 'owner', 'Me'), member('u4', 'owner', 'Otto')])
    renderAppAt('/tenants/acme/members')

    const me = await rowFor('Me')
    expect(me.getByRole('combobox', { name: 'Role for Me X' })).toBeEnabled()
    expect(me.getByRole('button', { name: 'Leave' })).toBeEnabled()
  })

  it('stacks members as cards on a phone, so no control sits off-screen', async () => {
    // At 390px the four-column table scrolled horizontally and put both the
    // Actions column and the last-owner explanation past the right edge. The
    // card path is ONE render path chosen in JS, not a CSS `sm:hidden` pair:
    // two paths in the DOM would mean two role selects sharing one id.
    setViewportWidth(390)
    mockTenant('owner', [member(ME, 'owner', 'A'), member('u2', 'viewer', 'Cleo')])
    renderAppAt('/tenants/acme/members')

    expect(await screen.findByText('Cleo X')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    // The controls that were off-screen are present and reachable.
    expect(screen.getByRole('combobox', { name: 'Role for Cleo X' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
  })

  it('says the list is empty rather than showing a bare table header', async () => {
    // A header row over nothing is the "blank void for no data" tell, and it
    // is what the visual gate caught. The error branch above still runs
    // FIRST: [] means "no members" only once we know the request answered.
    mockTenant('owner', [])
    renderAppAt('/tenants/acme/members')

    expect(await screen.findByText(/no one has access to this tenant yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  // The role used to be read off the tenant LIST, so a failed list hid every
  // control on this tab. It now comes from the tenant itself, and a list
  // failure (the switcher's problem) must not take the tab's controls with it.
  it('keeps the role-gated controls when the tenant LIST fails', async () => {
    server.use(
      http.get('/api/v1/tenants', () => fail('Something went wrong.', 500)),
      http.get('/api/v1/tenants/acme', () =>
        ok(tenantDetail(TENANT, 'owner'), 'Tenant retrieved.')
      ),
      http.get('/api/v1/tenants/acme/members', () =>
        ok([member(ME, 'owner', 'Me'), member('u3', 'viewer', 'Vic')], 'Members retrieved.')
      )
    )
    renderAppAt('/tenants/acme/members')

    const vic = await rowFor('Vic')
    expect(vic.getByRole('combobox', { name: 'Role for Vic X' })).toBeEnabled()
    expect(screen.queryByText(/could not load your role/i)).not.toBeInTheDocument()
  })

  /**
   * The role's error state, and the only way to reach it now. A FIRST load
   * that fails is the layout's error boundary, so the tab never mounts. A
   * REFETCH that fails keeps the cached row, the layout keeps rendering, and
   * the tab has to say what it no longer knows instead of spinning a skeleton.
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
        ok([member(ME, 'owner', 'Me'), member('u4', 'owner', 'Otto')], 'Members retrieved.')
      )
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/members')
    await screen.findByRole('combobox', { name: 'Role for Me X' })

    detailFails = true
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: tenantKeys.detail('acme'), exact: true })
    })

    const alert = await screen.findByRole('alert', {}, { timeout: 5000 })
    expect(alert).toHaveTextContent(/could not load your role/i)
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull()

    const before = detailCalls
    detailFails = false
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    // A NEW detail request, and the controls it gates come back with it.
    await waitFor(() => {
      expect(detailCalls).toBeGreaterThan(before)
    })
    expect(
      await screen.findByRole('combobox', { name: 'Role for Me X' }, { timeout: 5000 })
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  /**
   * The retry has to reach THE QUERY THAT FAILED, and the only proof of that
   * is a new request on the wire, counted. The members failure's retry must
   * refetch the members and leave the tenant detail (the role's source)
   * untouched.
   */
  it('retries the MEMBER LIST, not the tenant detail, when the members are what failed', async () => {
    let memberCalls = 0
    let detailCalls = 0
    server.use(
      http.get('/api/v1/tenants/acme', () => {
        detailCalls += 1
        return ok(tenantDetail(TENANT, 'owner'), 'Tenant retrieved.')
      }),
      http.get('/api/v1/tenants/acme/members', () => {
        memberCalls += 1
        return fail('Something went wrong.', 500)
      })
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/members')

    const alert = await screen.findByRole('alert', {}, { timeout: 5000 })
    expect(alert).toHaveTextContent(/could not load this tenant’s members/i)
    expect(screen.queryByText(/could not load your role/i)).not.toBeInTheDocument()

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

  it('shows BOTH failures when both queries fail, each with its own retry', async () => {
    let detailFails = false
    server.use(
      http.get('/api/v1/tenants/acme', () =>
        detailFails
          ? fail('Something went wrong.', 500)
          : ok(tenantDetail(TENANT, 'owner'), 'Tenant retrieved.')
      ),
      http.get('/api/v1/tenants/acme/members', () => fail('Something went wrong.', 500))
    )
    renderAppAt('/tenants/acme/members')
    await screen.findByRole('alert', {}, { timeout: 5000 })

    detailFails = true
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: tenantKeys.detail('acme'), exact: true })
    })

    // Stacked rather than chained: picking one branch would mean picking a
    // winner whose retry cannot fix the loser.
    await waitFor(() => {
      expect(screen.getAllByRole('alert')).toHaveLength(2)
    })
    const text = screen
      .getAllByRole('alert')
      .map((alert) => alert.textContent)
      .join(' ')
    expect(text).toMatch(/could not load this tenant’s members/i)
    expect(text).toMatch(/could not load your role in this tenant/i)
    for (const alert of screen.getAllByRole('alert')) {
      expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    }
  })

  it('changes a role through the API and reports it', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me'), member('u3', 'viewer', 'Vic')])
    let patched: unknown = null
    server.use(
      http.patch('/api/v1/tenants/acme/members/u3', async ({ request }) => {
        patched = await request.json()
        return ok(member('u3', 'editor', 'Vic').membership, 'Member role updated.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/members')

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
    mockTenant('owner', [member(ME, 'owner', 'Me'), member('u4', 'owner', 'Otto')])
  })

  it('points its label at the VISIBLE control, not at a hidden input', async () => {
    renderAppAt('/tenants/acme/members')

    const trigger = await screen.findByRole('combobox', { name: 'Role' })
    const label = screen.getByText('Role', { selector: 'label' })
    // Measured, not assumed: `FormControl`'s id lands on the Select's trigger
    // BUTTON. (A Base UI Checkbox is the opposite — there the id goes to the
    // hidden input, and a label would point at something invisible.)
    expect(label).toHaveAttribute('for', trigger.id)
    expect(trigger.tagName).toBe('BUTTON')
  })

  it('clears the server’s verdict on the role when the select changes', async () => {
    server.use(
      // A field-level verdict on `role`, which is what the clearing rule is
      // about. `fail()` carries no `errors` map, so this one is built here.
      http.post('/api/v1/tenants/acme/invitations', () =>
        HttpResponse.json(
          {
            success: false,
            message: 'Validation failed.',
            statusCode: 422,
            errors: { role: ['That role is not yours to grant.'] },
            requestId: 'test-request-id',
          },
          { status: 422 }
        )
      )
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/members')

    await user.type(await screen.findByLabelText('Email'), 'new@b.com')
    await user.click(screen.getByRole('button', { name: 'Invite member' }))
    await screen.findByText('That role is not yours to grant.')

    // Base UI's selection does NOT bubble a change event to the <form>, so
    // <Form>'s own clearing rule never fires for this control — the page
    // calls clearField by hand. Without that line this message would sit
    // there while the user changed the very field it is about.
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
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    mockTenant('owner', [member(ME, 'owner', 'Me'), member('u3', 'viewer', 'Vic')])
  })

  it('sends an invitation, says so, and refreshes the pending list', async () => {
    let body: unknown
    let listCalls = 0
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () => {
        listCalls += 1
        return ok(
          listCalls === 1 ? [] : [invitation('inv-2', 'new@b.com', { role: 'viewer' })],
          'Invitations retrieved.'
        )
      }),
      http.post('/api/v1/tenants/acme/invitations', async ({ request }) => {
        body = await request.json()
        return ok(null, 'If that address can be invited, an invitation has been sent.', 202)
      })
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/members')

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
        fail('That person is already a member.', 409, 'already_member')
      )
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/members')

    const email = await screen.findByLabelText('Email')
    await user.type(email, 'u3@b.com')
    await user.click(screen.getByRole('button', { name: 'Invite member' }))

    await waitFor(() => {
      expect(email).toHaveAccessibleDescription('That person is already a member.')
    })
    expect(email).toHaveAttribute('aria-invalid', 'true')
    // Once: inline. A toast as well would say the same thing twice.
    expect(screen.getAllByText('That person is already a member.')).toHaveLength(1)

    // Changing the address clears it, like any other server verdict.
    await user.type(email, 'x')
    await waitFor(() => {
      expect(screen.queryByText('That person is already a member.')).not.toBeInTheDocument()
    })
  })

  it('says a racing invite won, and shows it in the refreshed list', async () => {
    let listCalls = 0
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () => {
        listCalls += 1
        return ok(
          listCalls === 1 ? [] : [invitation('inv-9', 'new@b.com')],
          'Invitations retrieved.'
        )
      }),
      http.post('/api/v1/tenants/acme/invitations', () =>
        fail('An invitation for this address was just created.', 409, 'invitation_conflict')
      )
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/members')

    await user.type(await screen.findByLabelText('Email'), 'new@b.com')
    await user.click(screen.getByRole('button', { name: 'Invite member' }))

    expect(
      await screen.findByText('Someone just invited this address — refresh and try again.')
    ).toBeInTheDocument()
    // The winning invitation arrives with the refetch.
    expect(await screen.findByText('new@b.com', { selector: 'span' })).toBeInTheDocument()
  })

  it('toasts any other refusal and leaves the field alone', async () => {
    server.use(
      http.post('/api/v1/tenants/acme/invitations', () =>
        fail('Too many attempts. Please try again later.', 429, 'RATE_LIMITED')
      )
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/members')

    const email = await screen.findByLabelText('Email')
    await user.type(email, 'new@b.com')
    await user.click(screen.getByRole('button', { name: 'Invite member' }))

    expect(
      await screen.findByText('Too many attempts. Please try again later.')
    ).toBeInTheDocument()
    expect(email).toHaveAttribute('aria-invalid', 'false')
  })

  it('lists each pending invitation with its role, inviter and expiry', async () => {
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok(
          [testInvitation, invitation('inv-2', 'old@b.com', { role: 'viewer', invitedBy: null })],
          'Invitations retrieved.'
        )
      )
    )
    renderAppAt('/tenants/acme/members')

    expect(await screen.findByRole('heading', { name: 'Pending invitations' })).toBeInTheDocument()
    const first = within((await screen.findByText('invitee@b.com')).closest('li') as HTMLElement)
    expect(first.getByText('Editor · Invited by A B')).toBeInTheDocument()
    expect(first.getByText(/^Expires /)).toBeInTheDocument()
    // An inviter whose account is gone is `null`, not a crash.
    const second = within(screen.getByText('old@b.com').closest('li') as HTMLElement)
    expect(second.getByText('Viewer · Invited by A teammate')).toBeInTheDocument()
  })

  it('says when nothing is pending', async () => {
    renderAppAt('/tenants/acme/members')

    expect(
      await screen.findByText('No invitations are waiting to be accepted.')
    ).toBeInTheDocument()
  })

  it('offers a retry when the pending list fails, and the retry refetches it', async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () => {
        calls += 1
        // Two failures: the router's client retries once by itself.
        return calls <= 2
          ? fail('Something went wrong.', 500)
          : ok([testInvitation], 'Invitations retrieved.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/members')

    const alert = await screen.findByRole('alert', {}, { timeout: 5000 })
    expect(alert).toHaveTextContent(/could not load the pending invitations/i)
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('invitee@b.com')).toBeInTheDocument()
  })

  it('shows the section to an admin too', async () => {
    mockTenant('admin', [member(ME, 'admin', 'Me')])
    renderAppAt('/tenants/acme/members')

    expect(await screen.findByRole('heading', { name: 'Pending invitations' })).toBeInTheDocument()
  })

  it('resends one invitation, says so, and refreshes the list', async () => {
    let resent: unknown
    let listCalls = 0
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () => {
        listCalls += 1
        return ok([testInvitation], 'Invitations retrieved.')
      }),
      http.post('/api/v1/tenants/acme/invitations/:id/resend', ({ params }) => {
        resent = params.id
        return ok(null, 'Invitation resent.', 202)
      })
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/members')

    await user.click(
      await screen.findByRole('button', { name: 'Resend invitation to invitee@b.com' })
    )

    expect(await screen.findByText('Invitation resent to invitee@b.com.')).toBeInTheDocument()
    expect(resent).toBe('inv-1')
    // The expiry moved, so the list is fetched again.
    await waitFor(() => {
      expect(listCalls).toBeGreaterThan(1)
    })
  })

  it('shows the server’s message when a resend is refused, e.g. a 403', async () => {
    // Offered to an owner, and refused anyway: the server has the last word.
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok([invitation('inv-1', 'invitee@b.com', { role: 'owner' })], 'Invitations retrieved.')
      ),
      http.post('/api/v1/tenants/acme/invitations/:id/resend', () =>
        fail('You cannot manage an invitation for that role.', 403)
      )
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/members')

    await user.click(
      await screen.findByRole('button', { name: 'Resend invitation to invitee@b.com' })
    )

    expect(
      await screen.findByText('You cannot manage an invitation for that role.')
    ).toBeInTheDocument()
  })

  it('switches off Resend, with the reason, for a role an admin cannot grant', async () => {
    mockTenant('admin', [member(ME, 'admin', 'Me'), member('u3', 'viewer', 'Vic')])
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok(
          [
            invitation('inv-1', 'owner@b.com', { role: 'owner' }),
            invitation('inv-2', 'admin@b.com', { role: 'admin' }),
            invitation('inv-3', 'editor@b.com', { role: 'editor' }),
          ],
          'Invitations retrieved.'
        )
      )
    )
    renderAppAt('/tenants/acme/members')

    for (const email of ['owner@b.com', 'admin@b.com']) {
      const resend = await screen.findByRole('button', { name: `Resend invitation to ${email}` })
      expect(resend).toBeDisabled()
      expect(resend).toHaveAccessibleDescription(
        'Only an owner can resend an invitation for this role.'
      )
    }
    const editorResend = screen.getByRole('button', { name: 'Resend invitation to editor@b.com' })
    expect(editorResend).toBeEnabled()
    expect(editorResend).not.toHaveAttribute('aria-describedby')
  })

  it('lets an owner resend an invitation for every role', async () => {
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok(
          [
            invitation('inv-1', 'owner@b.com', { role: 'owner' }),
            invitation('inv-2', 'admin@b.com', { role: 'admin' }),
            invitation('inv-3', 'editor@b.com', { role: 'editor' }),
          ],
          'Invitations retrieved.'
        )
      )
    )
    renderAppAt('/tenants/acme/members')

    for (const email of ['owner@b.com', 'admin@b.com', 'editor@b.com']) {
      expect(
        await screen.findByRole('button', { name: `Resend invitation to ${email}` })
      ).toBeEnabled()
    }
    expect(
      screen.queryByText('Only an owner can resend an invitation for this role.')
    ).not.toBeInTheDocument()
  })

  it('says a resend found the invitation no longer pending, and refreshes the list', async () => {
    let listCalls = 0
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () => {
        listCalls += 1
        return ok(listCalls === 1 ? [testInvitation] : [], 'Invitations retrieved.')
      }),
      http.post('/api/v1/tenants/acme/invitations/:id/resend', () =>
        fail('Invitation not found.', 404, 'invitation_not_found')
      )
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/members')

    await user.click(
      await screen.findByRole('button', { name: 'Resend invitation to invitee@b.com' })
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
        ok([testInvitation], 'Invitations retrieved.')
      ),
      http.delete('/api/v1/tenants/acme/invitations/:id', () => {
        deletes += 1
        return ok(null, 'Invitation revoked.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/members')

    await user.click(
      await screen.findByRole('button', { name: 'Revoke invitation to invitee@b.com' })
    )
    // The app's AlertDialog, not a browser confirm().
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAccessibleName('Revoke the invitation to invitee@b.com?')
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
        ok(revoked ? [] : [testInvitation], 'Invitations retrieved.')
      ),
      http.delete('/api/v1/tenants/acme/invitations/:id', ({ params }) => {
        revoked = params.id
        return ok(null, 'Invitation revoked.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/members')

    await user.click(
      await screen.findByRole('button', { name: 'Revoke invitation to invitee@b.com' })
    )
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }))

    // The toast still arrives although the refetch unmounts the row first.
    expect(await screen.findByText('Invitation to invitee@b.com revoked.')).toBeInTheDocument()
    expect(revoked).toBe('inv-1')
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
        return ok(listCalls === 1 ? [testInvitation] : [], 'Invitations retrieved.')
      }),
      http.delete('/api/v1/tenants/acme/invitations/:id', () =>
        fail('Invitation not found.', 404, 'invitation_not_found')
      )
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/members')

    await user.click(
      await screen.findByRole('button', { name: 'Revoke invitation to invitee@b.com' })
    )
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }))

    expect(await screen.findByText('That invitation is no longer pending.')).toBeInTheDocument()
    // Someone else revoked or it was accepted: the row goes either way.
    expect(
      await screen.findByText('No invitations are waiting to be accepted.')
    ).toBeInTheDocument()
  })
})
