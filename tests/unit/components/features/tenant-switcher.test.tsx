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
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, tenantDetail, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { PlatformTenantRow } from '@/types/api.types'

function tenantRow(id: string, name: string, slug: string) {
  return {
    id,
    name,
    slug,
    description: null,
    logo: null,
    website: null,
    lifecycleState: 'active',
    isPlatform: false,
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const ACME = tenantRow('t1', 'Acme Corp', 'acme')
const PLATFORM = { ...tenantRow('tp', 'Platform', 'platform'), isPlatform: true }

function searchRow(id: string, name: string, slug: string): PlatformTenantRow {
  return {
    id,
    name,
    slug,
    lifecycleState: 'active',
    memberCount: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

const ACME_ROW = searchRow('t1', 'Acme Corp', 'acme')
const GLOBEX_ROW = searchRow('t2', 'Globex', 'globex')
const INITECH_ROW = searchRow('t3', 'Initech', 'initech')

/**
 * Driven through a real RouterProvider: the switcher reads
 * `useParams({ strict: false })` and navigates, neither of which exists
 * outside a router.
 */
function renderShell(path = '/dashboard'): AnyRouter {
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

/** The options only exist once the popup is open. */
async function openSwitcher() {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('combobox', { name: /^Switch tenant/ }))
  await screen.findByRole('dialog', { name: 'Switch tenant' })
  return user
}

function signInAs(platformRole: 'viewer' | null) {
  useAuthStore.setState({
    accessToken: 'access-token',
    user: { ...testUser, platformRole },
    isAuthenticated: true,
    isBootstrapped: true,
  })
}

/** Every `/platform/tenants` request's query string, in order. */
function recordSearches(respond: (url: URL) => Response | Promise<Response>) {
  const seen: URL[] = []
  server.use(
    http.get('/api/v1/platform/tenants', ({ request }) => {
      const url = new URL(request.url)
      seen.push(url)
      return respond(url)
    })
  )
  return seen
}

describe('TenantSwitcher', () => {
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    signInAs(null)
  })

  it('lists each tenant the account belongs to', async () => {
    server.use(
      http.get('/api/v1/tenants', () =>
        ok([{ tenant: ACME, role: 'owner', isPlatform: false }], 'Tenants.')
      )
    )
    renderShell()
    await openSwitcher()

    const mine = await screen.findByRole('group', { name: 'Your tenants' })
    expect(within(mine).getByRole('option', { name: 'Acme Corp' })).toBeInTheDocument()
  })

  // The platform tenant is a membership like any other, and the list carries
  // it. It is linked from the user menu instead, never switched to as if it
  // were a customer.
  it('leaves the platform tenant out of Your tenants', async () => {
    signInAs('viewer')
    server.use(
      http.get('/api/v1/tenants', () =>
        ok(
          [
            { tenant: ACME, role: 'owner', isPlatform: false },
            { tenant: PLATFORM, role: 'viewer', isPlatform: true },
          ],
          'Tenants.'
        )
      )
    )
    renderShell()
    await openSwitcher()

    await screen.findByRole('option', { name: 'Acme Corp' })
    expect(screen.queryByRole('option', { name: 'Platform' })).not.toBeInTheDocument()
  })

  it('says the account has no tenants when the list really is empty', async () => {
    renderShell()
    await openSwitcher()

    expect(await screen.findByText('No tenants yet')).toBeInTheDocument()
    expect(screen.queryByText('Tenants could not be loaded')).not.toBeInTheDocument()
  })

  it('says the list is still loading when the popup opens mid-flight', async () => {
    server.use(http.get('/api/v1/tenants', async () => delay('infinite')))
    renderShell()
    await openSwitcher()

    expect(await screen.findByText('Loading tenants…')).toBeInTheDocument()
    expect(screen.queryByText('No tenants yet')).not.toBeInTheDocument()
  })

  it('says the list FAILED, not that it is empty, when the query errors', async () => {
    server.use(http.get('/api/v1/tenants', () => fail('Something went wrong', 500)))
    renderShell()
    await openSwitcher()

    expect(await screen.findByText('Tenants could not be loaded')).toBeInTheDocument()
    expect(screen.queryByText('No tenants yet')).not.toBeInTheDocument()
  })

  it('filters Your tenants by what is typed', async () => {
    server.use(
      http.get('/api/v1/tenants', () =>
        ok(
          [
            { tenant: ACME, role: 'owner', isPlatform: false },
            { tenant: tenantRow('t9', 'Umbrella', 'umbrella'), role: 'viewer', isPlatform: false },
          ],
          'Tenants.'
        )
      )
    )
    renderShell()
    const user = await openSwitcher()
    await screen.findByRole('option', { name: 'Umbrella' })

    await user.type(screen.getByLabelText('Search tenants'), 'umb')

    expect(await screen.findByRole('option', { name: 'Umbrella' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Acme Corp' })).not.toBeInTheDocument()
  })

  // A non-staff caller gets a 404 there, and asking would only prove it.
  it('never asks for all tenants when the user is not staff', async () => {
    server.use(
      http.get('/api/v1/tenants', () =>
        ok([{ tenant: ACME, role: 'owner', isPlatform: false }], 'Tenants.')
      )
    )
    const seen = recordSearches(() => ok({ tenants: [], nextCursor: null }, 'Tenants.'))
    renderShell()
    const user = await openSwitcher()
    await screen.findByRole('option', { name: 'Acme Corp' })
    await user.type(screen.getByLabelText('Search tenants'), 'zzz')

    await screen.findByText('No tenants match your search')
    expect(seen).toHaveLength(0)
    expect(screen.queryByRole('group', { name: 'All tenants' })).not.toBeInTheDocument()
  })

  describe('as staff', () => {
    beforeEach(() => {
      signInAs('viewer')
    })

    it('adds an All tenants group, without repeating a tenant already in Your tenants', async () => {
      server.use(
        http.get('/api/v1/tenants', () =>
          ok([{ tenant: ACME, role: 'owner', isPlatform: false }], 'Tenants.')
        )
      )
      recordSearches(() => ok({ tenants: [ACME_ROW, GLOBEX_ROW], nextCursor: null }, 'Tenants.'))
      renderShell()
      await openSwitcher()

      const all = await screen.findByRole('group', { name: 'All tenants' })
      expect(within(all).getByRole('option', { name: 'Globex' })).toBeInTheDocument()
      expect(within(all).queryByRole('option', { name: 'Acme Corp' })).not.toBeInTheDocument()
      expect(screen.getAllByRole('option', { name: 'Acme Corp' })).toHaveLength(1)
    })

    // Four keystrokes inside the 250ms window: one request for the word, not
    // one per letter.
    it('debounces the search, sending one request for a burst of typing', async () => {
      const seen = recordSearches((url) =>
        ok(
          { tenants: url.searchParams.get('q') === 'glob' ? [GLOBEX_ROW] : [], nextCursor: null },
          'Tenants.'
        )
      )
      renderShell()
      const user = await openSwitcher()
      await waitFor(() => {
        expect(seen).toHaveLength(1)
      })
      // An empty box is no `q` at all: the API refuses a zero-length term.
      expect(seen[0]?.searchParams.has('q')).toBe(false)

      await user.type(screen.getByLabelText('Search tenants'), 'glob')

      expect(await screen.findByRole('option', { name: 'Globex' })).toBeInTheDocument()
      const terms = seen.map((url) => url.searchParams.get('q')).filter((q) => q !== null)
      expect(terms).toEqual(['glob'])
    })

    it('says the search FAILED rather than that nothing matched', async () => {
      recordSearches(() => fail('Something went wrong', 500))
      renderShell()
      await openSwitcher()

      expect(
        await screen.findByText('All tenants could not be loaded', {}, { timeout: 5000 })
      ).toBeInTheDocument()
    })

    // Keyboard-reachable, not scroll-only: the option sits in the arrow-key
    // order, and Enter on it loads the next page and keeps the popup open.
    it('loads the next page from a Load more option chosen by keyboard', async () => {
      const seen = recordSearches((url) =>
        url.searchParams.get('cursor') === 'c2'
          ? ok({ tenants: [INITECH_ROW], nextCursor: null }, 'Tenants.')
          : ok({ tenants: [GLOBEX_ROW], nextCursor: 'c2' }, 'Tenants.')
      )
      renderShell()
      const user = await openSwitcher()
      const input = screen.getByLabelText('Search tenants')
      const more = await screen.findByRole('option', { name: 'Load more tenants' })

      await user.click(input)
      for (let step = 0; step < 5; step += 1) {
        if (input.getAttribute('aria-activedescendant') === more.id) break
        await user.keyboard('{ArrowDown}')
      }
      expect(input).toHaveAttribute('aria-activedescendant', more.id)
      await user.keyboard('{Enter}')

      expect(await screen.findByRole('option', { name: 'Initech' })).toBeInTheDocument()
      expect(seen.at(-1)?.searchParams.get('cursor')).toBe('c2')
      expect(screen.getByRole('option', { name: 'Globex' })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: 'Load more tenants' })).not.toBeInTheDocument()
      expect(screen.getByRole('dialog', { name: 'Switch tenant' })).toBeInTheDocument()
    })

    it('navigates to the chosen tenant', async () => {
      recordSearches(() => ok({ tenants: [GLOBEX_ROW], nextCursor: null }, 'Tenants.'))
      server.use(
        http.get('/api/v1/tenants/globex', () =>
          ok(
            tenantDetail(tenantRow('t2', 'Globex', 'globex'), 'viewer', 'platform'),
            'Tenant retrieved.'
          )
        )
      )
      const router = renderShell()
      const user = await openSwitcher()

      await user.click(await screen.findByRole('option', { name: 'Globex' }))

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/tenants/globex')
      })
    })

    // Staff have no list row for a tenant they reached by platform access, so
    // the label comes from the tenant the route has already loaded.
    it('names a tenant opened by platform access in the trigger', async () => {
      server.use(
        http.get('/api/v1/tenants/globex', () =>
          ok(
            tenantDetail(tenantRow('t2', 'Globex', 'globex'), 'viewer', 'platform'),
            'Tenant retrieved.'
          )
        )
      )
      renderShell('/tenants/globex')

      expect(
        await screen.findByRole('combobox', { name: 'Switch tenant. Current: Globex' })
      ).toBeInTheDocument()
    })
  })
})
