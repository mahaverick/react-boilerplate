import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MembershipRole } from '@/constants/roles'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

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
    http.get('/api/v1/tenants/acme', () => ok(TENANT, 'Tenant retrieved.')),
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

  it('offers an admin only the roles below admin when adding someone', async () => {
    mockTenant('admin', [member(ME, 'admin', 'Me')])
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/members')

    await user.click(await screen.findByRole('combobox', { name: 'Role' }))
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent)
    // canActorGrantRole: an admin may grant anything EXCEPT owner and admin.
    expect(options).toEqual(['Manager', 'Editor', 'Viewer'])
  })

  it('offers an owner every role when adding someone', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me'), member('u4', 'owner', 'Otto')])
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/members')

    await user.click(await screen.findByRole('combobox', { name: 'Role' }))
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent)
    expect(options).toEqual(['Owner', 'Admin', 'Manager', 'Editor', 'Viewer'])
  })

  it('gives a viewer no controls and no add-member form', async () => {
    mockTenant('viewer', [member(ME, 'viewer', 'Me'), member('u3', 'viewer', 'Vic')])
    renderAppAt('/tenants/acme/members')

    await screen.findByRole('heading', { name: 'Members' })
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove|Leave/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Add a member' })).not.toBeInTheDocument()
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

  it('renders an error, not an endless skeleton, when the role lookup fails', async () => {
    server.use(
      http.get('/api/v1/tenants', () => fail('Something went wrong.', 500)),
      http.get('/api/v1/tenants/acme', () => ok(TENANT, 'Tenant retrieved.')),
      http.get('/api/v1/tenants/acme/members', () => ok([], 'Members retrieved.'))
    )
    renderAppAt('/tenants/acme/members')

    // The failure mode this guards: `useMyRole` used to report a failed list
    // as `{ role: undefined, isPending: false }`, and every tab read `!role`
    // as "still loading" — so an API failure spun a skeleton for ever, with
    // no error, no retry and no way out.
    // Generous, deliberately: the router's queryClient is configured
    // `retry: 1`, so a failed list is attempted a second time (after
    // react-query's ~1s backoff) before the error state is reached at all.
    const alert = await screen.findByRole('alert', {}, { timeout: 5000 })
    expect(alert).toHaveTextContent(/could not load your role/i)
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull()
  })

  it('recovers when the retry succeeds', async () => {
    let attempt = 0
    server.use(
      // The first TWO attempts fail, not just one: the queryClient is
      // `retry: 1`, so react-query itself makes the second attempt and the
      // query would otherwise recover on its own without ever showing the
      // error this test is about.
      http.get('/api/v1/tenants', () => {
        attempt += 1
        return attempt <= 2
          ? fail('Something went wrong.', 500)
          : ok([{ tenant: TENANT, role: 'owner' }], 'Tenants retrieved.')
      }),
      http.get('/api/v1/tenants/acme', () => ok(TENANT, 'Tenant retrieved.')),
      http.get('/api/v1/tenants/acme/members', () =>
        ok([member(ME, 'owner', 'Me'), member('u4', 'owner', 'Otto')], 'Members retrieved.')
      )
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/members')

    const alert = await screen.findByRole('alert', {}, { timeout: 5000 })
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    // The retry control is not decoration: the table arrives after it.
    // The retry control is not decoration: the table arrives after it, with
    // the role-gated controls this owner is entitled to. (Otto's row
    // deliberately has no select — an owner may not act on another owner.)
    expect(
      await screen.findByRole('combobox', { name: 'Role for Me X' }, { timeout: 5000 })
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  /**
   * The retry has to reach THE QUERY THAT FAILED, and the only proof of that
   * is a new request on the wire.
   *
   * What this replaces: a members failure was folded into the role branch, so
   * the tab said "We could not load your role in this tenant" — about a query
   * that had SUCCEEDED — under a Try again wired to `useMyRole`'s retry, which
   * is `useTenants().refetch`. Measured before the fix: the members call count
   * was 2 before the click and 2 after it, and the panel never left. Asserting
   * that a handler fired would not have caught that; asserting the COUNT does.
   */
  it('retries the MEMBER LIST, not the tenant list, when the members are what failed', async () => {
    let memberCalls = 0
    let tenantCalls = 0
    server.use(
      http.get('/api/v1/tenants', () => {
        tenantCalls += 1
        return ok([{ tenant: TENANT, role: 'owner' }], 'Tenants retrieved.')
      }),
      http.get('/api/v1/tenants/acme', () => ok(TENANT, 'Tenant retrieved.')),
      http.get('/api/v1/tenants/acme/members', () => {
        memberCalls += 1
        return fail('Something went wrong.', 500)
      })
    )
    const user = userEvent.setup()
    renderAppAt('/tenants/acme/members')

    // The message names the query that actually failed — and NOT the role,
    // which loaded perfectly well and whose controls the tab could still gate
    // on if the list arrived.
    const alert = await screen.findByRole('alert', {}, { timeout: 5000 })
    expect(alert).toHaveTextContent(/could not load this tenant’s members/i)
    expect(screen.queryByText(/could not load your role/i)).not.toBeInTheDocument()

    // Two, not one: the queryClient is `retry: 1`, so react-query has already
    // made the second attempt by the time the error state renders.
    await waitFor(() => {
      expect(memberCalls).toBe(2)
    })
    const membersBefore = memberCalls
    const tenantsBefore = tenantCalls

    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    // THE PAIR is what proves it: a new members request went out, and the
    // tenant list — the query the broken retry used to refetch instead — was
    // not touched.
    await waitFor(() => {
      expect(memberCalls).toBeGreaterThan(membersBefore)
    })
    expect(tenantCalls).toBe(tenantsBefore)
  })

  it('shows BOTH failures when both queries fail, each with its own retry', async () => {
    server.use(
      http.get('/api/v1/tenants', () => fail('Something went wrong.', 500)),
      http.get('/api/v1/tenants/acme', () => ok(TENANT, 'Tenant retrieved.')),
      http.get('/api/v1/tenants/acme/members', () => fail('Something went wrong.', 500))
    )
    renderAppAt('/tenants/acme/members')

    // Stacked rather than chained: picking one branch would mean picking a
    // winner whose retry cannot fix the loser.
    const alerts = await screen.findAllByRole('alert', {}, { timeout: 5000 })
    expect(alerts).toHaveLength(2)
    expect(alerts.map((alert) => alert.textContent).join(' ')).toMatch(
      /could not load this tenant’s members/i
    )
    expect(alerts.map((alert) => alert.textContent).join(' ')).toMatch(
      /could not load your role in this tenant/i
    )
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

describe('the add-member role select', () => {
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
    await user.click(screen.getByRole('button', { name: 'Add member' }))
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
