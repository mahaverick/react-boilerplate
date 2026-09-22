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
import { beforeEach, describe, expect, it } from 'vitest'
import type { MembershipRole } from '@/constants/roles'
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

describe('members tab permissions', () => {
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
    expect(
      me.getAllByText('A tenant must always have an owner. Add another owner first.').length
    ).toBeGreaterThan(0)
  })

  it('re-enables them once a second owner exists', async () => {
    mockTenant('owner', [member(ME, 'owner', 'Me'), member('u4', 'owner', 'Otto')])
    renderAppAt('/tenants/acme/members')

    const me = await rowFor('Me')
    expect(me.getByRole('combobox', { name: 'Role for Me X' })).toBeEnabled()
    expect(me.getByRole('button', { name: 'Leave' })).toBeEnabled()
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
      http.post('/api/v1/tenants/acme/members', () =>
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
