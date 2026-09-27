import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import type { MembershipRole } from '@/constants/roles'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { PlatformAuditEntry, PlatformTenantRow } from '@/types/api.types'

const STAFF_VISIT: PlatformAuditEntry = {
  id: 'p1',
  occurredAt: '2026-09-25T10:00:00.000Z',
  action: 'tenant.accessed_by_platform',
  access: 'platform',
  actor: { id: 's1', name: 'Sam Staff', email: 'sam@platform.test' },
  target: { type: 'tenant', id: 't1' },
  metadata: { platformRole: 'viewer' },
  tenant: { id: 't1', name: 'Acme Corp', slug: 'acme' },
}

function signInAs(platformRole: MembershipRole | null) {
  useAuthStore.setState({
    accessToken: 'access-token',
    user: { ...testUser, platformRole },
    isAuthenticated: true,
    isBootstrapped: true,
  })
}

function mockLog(respond: (url: URL) => Response) {
  const seen: URL[] = []
  server.use(
    http.get('/api/v1/platform/audit-log', ({ request }) => {
      const url = new URL(request.url)
      seen.push(url)
      return respond(url)
    }),
    http.get('/api/v1/tenants/platform/members', () => ok([], 'Members retrieved.'))
  )
  return seen
}

const ACME_ROW: PlatformTenantRow = {
  id: 't1',
  name: 'Acme Corp',
  slug: 'acme',
  lifecycleState: 'active',
  memberCount: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
}
const GLOBEX_ROW: PlatformTenantRow = { ...ACME_ROW, id: 't2', name: 'Globex', slug: 'globex' }

/** Answers the platform tenant search, recording each request's `q` in order (null when absent). */
function mockTenantSearch(respond: (q: string | null) => Response | Promise<Response>) {
  const terms: (string | null)[] = []
  server.use(
    http.get('/api/v1/platform/tenants', ({ request }) => {
      const q = new URL(request.url).searchParams.get('q')
      terms.push(q)
      return respond(q)
    })
  )
  return terms
}

function tenantPage(tenants: PlatformTenantRow[]) {
  return ok({ tenants, nextCursor: null }, 'Tenants retrieved.')
}

function renderPlatformActivity() {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ['/platform/activity'] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
}

describe('platform activity page', () => {
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
  })

  it('lists activity across tenants, each row linking to its tenant', async () => {
    signInAs('admin')
    mockLog(() => ok({ entries: [STAFF_VISIT], nextCursor: null }, 'Audit log retrieved.'))
    renderPlatformActivity()

    expect(
      await screen.findByRole('heading', { name: 'Platform activity', level: 1 })
    ).toBeVisible()
    const text = await screen.findByText('opened this tenant as platform staff (Viewer)')
    const row = text.closest('li')
    if (!row) throw new Error('no activity row')
    expect(within(row).getByRole('link', { name: 'Acme Corp' })).toHaveAttribute(
      'href',
      '/tenants/acme'
    )
    expect(within(row).getByText('Staff')).toBeInTheDocument()
  })

  // Matches the API's 404: the page must not tell a non-admin it exists.
  it.each([
    ['someone who is not staff', null],
    ['a staff viewer', 'viewer'],
    ['a staff editor', 'editor'],
  ] as const)('shows %s a not-found panel and never asks the API', async (_who, role) => {
    signInAs(role)
    const seen = mockLog(() => ok({ entries: [], nextCursor: null }, 'Audit log retrieved.'))
    renderPlatformActivity()

    expect(await screen.findByRole('heading', { name: 'Page not available' })).toBeInTheDocument()
    expect(seen).toHaveLength(0)
  })

  // Demoted after the profile loaded: the API's 404 gets the same panel.
  it('turns a 404 from the API into the not-found panel', async () => {
    signInAs('admin')
    mockLog(() => fail('Not found', 404))
    renderPlatformActivity()

    expect(await screen.findByRole('heading', { name: 'Page not available' })).toBeInTheDocument()
  })

  it('narrows to what staff did or saw with the Staff only switch', async () => {
    signInAs('owner')
    const seen = mockLog(() => ok({ entries: [STAFF_VISIT], nextCursor: null }, 'Audit log.'))
    const user = userEvent.setup()
    renderPlatformActivity()
    await screen.findByText(/opened this tenant/)

    await user.click(screen.getByRole('switch', { name: 'Staff only' }))

    await waitFor(() => {
      expect(seen.at(-1)?.searchParams.get('access')).toBe('platform')
    })
  })

  // A visible label is part of the control, not a decoration next to it:
  // clicking the WORDS must toggle the switch too.
  it('toggles the Staff only switch by clicking its label text', async () => {
    signInAs('owner')
    const seen = mockLog(() => ok({ entries: [STAFF_VISIT], nextCursor: null }, 'Audit log.'))
    const user = userEvent.setup()
    renderPlatformActivity()
    await screen.findByText(/opened this tenant/)

    await user.click(screen.getByText('Staff only'))

    await waitFor(() => {
      expect(seen.at(-1)?.searchParams.get('access')).toBe('platform')
    })
  })

  it('filters to one tenant chosen from the platform search', async () => {
    signInAs('admin')
    const seen = mockLog(() => ok({ entries: [STAFF_VISIT], nextCursor: null }, 'Audit log.'))
    const terms = mockTenantSearch((q) =>
      tenantPage(q === 'acm' ? [ACME_ROW] : [ACME_ROW, GLOBEX_ROW])
    )
    const user = userEvent.setup()
    renderPlatformActivity()
    await screen.findByText(/opened this tenant/)

    await user.type(screen.getByLabelText('Filter by tenant'), 'acm')
    // Pick from the settled `acm` answer, not from the empty-term list the
    // debounced search replaces: Globex is only in the empty-term list.
    await waitFor(() => {
      expect(terms.at(-1)).toBe('acm')
    })
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: 'Globex' })).not.toBeInTheDocument()
    })
    await user.click(await screen.findByRole('option', { name: 'Acme Corp' }))

    await waitFor(() => {
      expect(seen.at(-1)?.searchParams.get('tenantId')).toBe('t1')
    })

    await user.click(screen.getByRole('button', { name: 'Clear the tenant filter' }))

    await waitFor(() => {
      expect(seen.at(-1)?.searchParams.has('tenantId')).toBe(false)
    })
    expect(screen.getByLabelText('Filter by tenant')).toHaveValue('')
  })

  // A pick made while the next search is in flight lands on an option that is
  // still there: the earlier results stay listed until the new ones arrive.
  it('keeps the earlier results pickable while the next search is in flight', async () => {
    signInAs('admin')
    const seen = mockLog(() => ok({ entries: [STAFF_VISIT], nextCursor: null }, 'Audit log.'))
    let releaseAcm!: () => void
    const acmHeld = new Promise<void>((resolve) => {
      releaseAcm = resolve
    })
    const terms = mockTenantSearch(async (q) => {
      if (q !== 'acm') return tenantPage([ACME_ROW, GLOBEX_ROW])
      await acmHeld
      return tenantPage([ACME_ROW])
    })
    const user = userEvent.setup()
    renderPlatformActivity()
    await screen.findByText(/opened this tenant/)

    await user.click(screen.getByLabelText('Filter by tenant'))
    expect(await screen.findByRole('option', { name: 'Globex' })).toBeInTheDocument()

    try {
      await user.keyboard('acm')
      await waitFor(() => {
        expect(terms.at(-1)).toBe('acm')
      })
      // The `acm` answer is held, so these are still the empty-term results.
      expect(screen.getByRole('option', { name: 'Globex' })).toBeInTheDocument()
      await user.click(screen.getByRole('option', { name: 'Acme Corp' }))

      await waitFor(() => {
        expect(seen.at(-1)?.searchParams.get('tenantId')).toBe('t1')
      })
    } finally {
      releaseAcm()
    }
  })

  it('says it is searching, not that nothing matched, while the next search loads', async () => {
    signInAs('admin')
    mockLog(() => ok({ entries: [STAFF_VISIT], nextCursor: null }, 'Audit log.'))
    let releaseZz!: () => void
    const zzHeld = new Promise<void>((resolve) => {
      releaseZz = resolve
    })
    const terms = mockTenantSearch(async (q) => {
      if (q === 'zz') await zzHeld
      return tenantPage([])
    })
    const user = userEvent.setup()
    renderPlatformActivity()
    await screen.findByText(/opened this tenant/)

    await user.click(screen.getByLabelText('Filter by tenant'))
    expect(await screen.findByText('No tenants match')).toBeInTheDocument()

    try {
      await user.keyboard('zz')
      await waitFor(() => {
        expect(terms.at(-1)).toBe('zz')
      })
      expect(screen.getByText('Searching…')).toBeInTheDocument()
      expect(screen.queryByText('No tenants match')).not.toBeInTheDocument()
    } finally {
      releaseZz()
    }
    expect(await screen.findByText('No tenants match')).toBeInTheDocument()
  })

  it('says the tenant search FAILED, not that nothing matched', async () => {
    signInAs('admin')
    mockLog(() => ok({ entries: [STAFF_VISIT], nextCursor: null }, 'Audit log.'))
    server.use(http.get('/api/v1/platform/tenants', () => fail('Something went wrong', 500)))
    const user = userEvent.setup()
    renderPlatformActivity()
    await screen.findByText(/opened this tenant/)

    await user.click(screen.getByLabelText('Filter by tenant'))

    expect(await screen.findByText('Tenants could not be loaded')).toBeInTheDocument()
    expect(screen.queryByText('No tenants match')).not.toBeInTheDocument()
  })

  it('does not search for tenants until the tenant filter is opened', async () => {
    signInAs('admin')
    mockLog(() => ok({ entries: [STAFF_VISIT], nextCursor: null }, 'Audit log.'))
    const seen: URL[] = []
    server.use(
      http.get('/api/v1/platform/tenants', ({ request }) => {
        seen.push(new URL(request.url))
        return ok({ tenants: [], nextCursor: null }, 'Tenants retrieved.')
      })
    )
    const user = userEvent.setup()
    renderPlatformActivity()
    await screen.findByText(/opened this tenant/)

    expect(seen).toHaveLength(0)

    await user.click(screen.getByLabelText('Filter by tenant'))

    await waitFor(() => {
      expect(seen.length).toBeGreaterThan(0)
    })
  })
})
