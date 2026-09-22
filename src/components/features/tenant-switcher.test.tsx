import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const ACME = {
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

/**
 * Driven through a real RouterProvider: the switcher reads
 * `useParams({ strict: false })` and renders `<Link>` items, neither of which
 * exists outside a router. `/dashboard` is a route with no `$slug`, which is
 * the common case the `strict: false` exists for.
 */
function renderShell() {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ['/dashboard'] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
}

/** The menu's contents only exist once it is open. */
async function openSwitcher() {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /Switch tenant/ }))
  return user
}

describe('TenantSwitcher', () => {
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

  it('lists each tenant the account belongs to', async () => {
    server.use(http.get('/api/v1/tenants', () => ok([{ tenant: ACME, role: 'owner' }], 'Tenants.')))
    renderShell()
    await openSwitcher()

    expect(await screen.findByRole('menuitem', { name: 'Acme Corp' })).toBeInTheDocument()
  })

  // The default handler answers an empty list, so this is the genuine
  // "you belong to nothing" case — and it must keep saying so.
  it('says the account has no tenants when the list really is empty', async () => {
    renderShell()
    await openSwitcher()

    expect(await screen.findByText('No tenants yet')).toBeInTheDocument()
    expect(screen.queryByText('Tenants could not be loaded')).not.toBeInTheDocument()
  })

  // The THIRD state this menu needs and had only two of. `tenants.data` is
  // undefined mid-flight exactly as it is after a failure and for an empty
  // account, and with no pending branch the chain fell through to the empty
  // one — so a menu opened while the list was still in the air answered "No
  // tenants yet", on strictly less evidence than the error case it sits
  // beside.
  it('says the list is still loading when the menu opens mid-flight', async () => {
    server.use(http.get('/api/v1/tenants', async () => delay('infinite')))
    renderShell()
    await openSwitcher()

    expect(await screen.findByText('Loading tenants…')).toBeInTheDocument()
    expect(screen.queryByText('No tenants yet')).not.toBeInTheDocument()
    expect(screen.queryByText('Tenants could not be loaded')).not.toBeInTheDocument()
  })

  // The fourth instance of the false-empty-state defect. `tenants.data` is
  // undefined for a failed load exactly as it is for an empty one, so this
  // menu used to state "No tenants yet" as a fact about an account it had
  // learned nothing about.
  it('says the list FAILED, not that it is empty, when the query errors', async () => {
    server.use(http.get('/api/v1/tenants', () => fail('Something went wrong', 500)))
    renderShell()
    await openSwitcher()

    expect(await screen.findByText('Tenants could not be loaded')).toBeInTheDocument()
    expect(screen.queryByText('No tenants yet')).not.toBeInTheDocument()
  })
})
