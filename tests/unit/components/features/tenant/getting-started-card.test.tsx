import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MembershipRole } from '@/constants/roles'
import { resetSessionForTests } from '@/http/session'
import { tenantKeys } from '@/queries/tenant.queries'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, tenantDetail, testOnboarding, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { TenantAccess, TenantOnboarding } from '@/types/api.types'

const TENANT = {
  id: TENANT_ID,
  name: 'Acme Corp',
  slug: 'acme',
  description: 'Anvils',
  logo: null,
  website: 'https://acme.test',
  lifecycleState: 'active',
  deletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const SETTINGS = {
  tenantId: TENANT_ID,
  timezone: 'Europe/London',
  locale: 'en',
  metadata: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const HOUR_MS = 60 * 60 * 1000

/** The tenant as `role`, reached through `access`, with `onboarding` served until a test swaps it. */
function mockTenant(
  role: MembershipRole,
  access: TenantAccess = 'member',
  onboarding: TenantOnboarding = testOnboarding()
) {
  server.use(
    http.get('/api/v1/tenants', () =>
      ok(access === 'member' ? [{ tenant: TENANT, role }] : [], 'Tenants retrieved.')
    ),
    http.get('/api/v1/tenants/acme', () =>
      ok(tenantDetail(TENANT, role, access), 'Tenant retrieved.')
    ),
    http.get('/api/v1/tenants/acme/settings', () => ok(SETTINGS, 'Settings retrieved.')),
    http.get('/api/v1/tenants/acme/onboarding', () => ok(onboarding, 'Onboarding retrieved.'))
  )
}

function renderOverview() {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ['/tenants/acme'] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return router
}

/** The checklist card, found by its own heading. */
async function findCard(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: 'Getting started', level: 2 })
  const card = heading.closest('[data-slot="card"]')
  if (!(card instanceof HTMLElement)) throw new Error('the heading is not inside a card')
  return card
}

/**
 * The barrier for a negative check: the checklist response is in the cache,
 * then one settle for the render that follows it, which has no event.
 */
async function onboardingLoaded() {
  await waitFor(() => {
    expect(queryClient.getQueryState(tenantKeys.onboarding('acme'))?.status).toBe('success')
  })
  await settle(50, 'the render after a cached result has no event to await')
}

/** One step's row, by its title. */
function stepRow(card: HTMLElement, title: string): HTMLElement {
  const row = within(card).getByText(title).closest('li')
  if (!(row instanceof HTMLElement)) throw new Error(`no row for ${title}`)
  return row
}

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

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Getting started card', () => {
  it('sits above the Overview card, with the steps in the order the server serves them', async () => {
    mockTenant('owner')
    renderOverview()

    const card = await findCard()
    const overview = screen.getByRole('heading', { name: 'Overview', level: 2 })
    expect(card.compareDocumentPosition(overview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const titles = within(card)
      .getAllByRole('listitem')
      .map((item) => item.querySelector('.font-medium')?.textContent)
    expect(titles).toEqual([
      'Configure your settings',
      'Invite a teammate',
      'A teammate joins',
      'Read the getting started guide',
    ])
    expect(within(card).getByText('0 of 2 required')).toBeInTheDocument()
    expect(within(stepRow(card, 'A teammate joins')).getByText('Optional')).toBeInTheDocument()
    expect(
      within(stepRow(card, 'Read the getting started guide')).getByText('Optional')
    ).toBeInTheDocument()
    expect(within(stepRow(card, 'Invite a teammate')).queryByText('Optional')).toBeNull()
  })

  it('marks done steps as done in text, with no checkbox anywhere', async () => {
    mockTenant('owner', 'member', testOnboarding({}, ['configure_settings']))
    renderOverview()

    const card = await findCard()
    expect(within(card).getByText('1 of 2 required')).toBeInTheDocument()
    expect(within(stepRow(card, 'Configure your settings')).getByText('Done')).toBeInTheDocument()
    expect(within(stepRow(card, 'Invite a teammate')).getByText('Not done')).toBeInTheDocument()
    // A done step offers nothing more.
    expect(within(stepRow(card, 'Configure your settings')).queryByRole('link')).toBeNull()
    expect(within(card).queryByRole('checkbox')).toBeNull()
  })

  it.each(['owner', 'admin'] as const)(
    'links an %s to where each auto step gets done, and offers nothing for one that happens on its own',
    async (role) => {
      mockTenant(role)
      renderOverview()

      const card = await findCard()
      expect(
        within(stepRow(card, 'Configure your settings')).getByRole('link', {
          name: 'Open settings',
        })
      ).toHaveAttribute('href', '/tenants/acme/settings')
      expect(
        within(stepRow(card, 'Invite a teammate')).getByRole('link', { name: 'Open members' })
      ).toHaveAttribute('href', '/tenants/acme/members')
      const joined = stepRow(card, 'A teammate joins')
      expect(within(joined).queryByRole('link')).toBeNull()
      expect(within(joined).queryByRole('button')).toBeNull()
      expect(within(card).queryByText('An owner or admin can do this')).toBeNull()
    }
  )

  it.each(['manager', 'editor', 'viewer'] as const)(
    'tells a %s who can do the linked steps, and links nothing',
    async (role) => {
      mockTenant(role)
      renderOverview()

      const card = await findCard()
      expect(within(card).queryByRole('link')).toBeNull()
      expect(
        within(stepRow(card, 'Configure your settings')).getByText('An owner or admin can do this')
      ).toBeInTheDocument()
      expect(
        within(stepRow(card, 'Invite a teammate')).getByText('An owner or admin can do this')
      ).toBeInTheDocument()
      expect(
        within(stepRow(card, 'A teammate joins')).queryByText('An owner or admin can do this')
      ).toBeNull()
      // Their own member step is still theirs to mark.
      expect(
        within(card).getByRole('button', { name: 'Mark “Read the getting started guide” done' })
      ).toBeInTheDocument()
    }
  )

  it('marks the viewer’s own member step done, and shows it done after the refetch', async () => {
    let served = testOnboarding()
    let completedKey: string | undefined
    mockTenant('editor')
    server.use(
      http.get('/api/v1/tenants/acme/onboarding', () => ok(served, 'Onboarding retrieved.')),
      http.post('/api/v1/tenants/acme/onboarding/steps/:key/complete', ({ params }) => {
        completedKey = String(params.key)
        served = testOnboarding({}, ['read_getting_started'])
        return ok(served, 'Onboarding step completed.')
      })
    )
    const user = userEvent.setup()
    renderOverview()

    const card = await findCard()
    await user.click(
      within(card).getByRole('button', { name: 'Mark “Read the getting started guide” done' })
    )

    await waitFor(() => {
      expect(
        within(stepRow(card, 'Read the getting started guide')).getByText('Done')
      ).toBeInTheDocument()
    })
    expect(completedKey).toBe('read_getting_started')
    expect(within(card).queryByRole('button', { name: /^Mark/ })).toBeNull()
    expect(await screen.findByText('“Read the getting started guide” marked done.')).toBeVisible()
  })

  it('shows the server’s refusal of Mark done as a toast', async () => {
    mockTenant('editor')
    server.use(
      http.post('/api/v1/tenants/acme/onboarding/steps/:key/complete', () =>
        fail('Onboarding is not tracked for this tenant.', 409, 'not_tracked')
      )
    )
    const user = userEvent.setup()
    renderOverview()

    const card = await findCard()
    await user.click(within(card).getByRole('button', { name: /^Mark/ }))
    expect(await screen.findByText('Onboarding is not tracked for this tenant.')).toBeVisible()
  })

  it('lets an owner dismiss behind a confirmation, and show it again', async () => {
    let served = testOnboarding()
    const posted: string[] = []
    mockTenant('owner')
    server.use(
      http.get('/api/v1/tenants/acme/onboarding', () => ok(served, 'Onboarding retrieved.')),
      http.post('/api/v1/tenants/acme/onboarding/dismiss', () => {
        posted.push('dismiss')
        served = testOnboarding({ state: 'dismissed', dismissedAt: '2026-10-01T09:00:00.000Z' })
        return ok(served, 'Onboarding dismissed.')
      }),
      http.post('/api/v1/tenants/acme/onboarding/undismiss', () => {
        posted.push('undismiss')
        served = testOnboarding()
        return ok(served, 'Onboarding restored.')
      })
    )
    const user = userEvent.setup()
    renderOverview()

    const card = await findCard()
    await user.click(within(card).getByRole('button', { name: 'Dismiss' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAccessibleName('Dismiss getting started?')
    // Opening the confirmation posts nothing.
    expect(posted).toEqual([])

    await user.click(within(dialog).getByRole('button', { name: 'Dismiss' }))

    const show = await screen.findByRole('button', { name: 'Show getting started' })
    expect(posted).toEqual(['dismiss'])
    expect(screen.queryByRole('heading', { name: 'Getting started' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Overview', level: 2 })).toBeInTheDocument()

    await user.click(show)
    await findCard()
    expect(posted).toEqual(['dismiss', 'undismiss'])
  })

  it('closes the confirmation and shows the server’s copy when a dismissal is refused', async () => {
    mockTenant('owner')
    server.use(
      http.post('/api/v1/tenants/acme/onboarding/dismiss', () =>
        fail('Getting started is already dismissed.', 409, 'dismiss_state')
      )
    )
    const user = userEvent.setup()
    renderOverview()

    const card = await findCard()
    await user.click(within(card).getByRole('button', { name: 'Dismiss' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Dismiss' })
    )

    expect(await screen.findByText('Getting started is already dismissed.')).toBeVisible()
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })
  })

  it('shows the server’s copy when showing getting started again is refused', async () => {
    mockTenant(
      'owner',
      'member',
      testOnboarding({ state: 'dismissed', dismissedAt: '2026-10-01T09:00:00.000Z' })
    )
    server.use(
      http.post('/api/v1/tenants/acme/onboarding/undismiss', () =>
        fail('Getting started is not dismissed.', 409, 'dismiss_state')
      )
    )
    const user = userEvent.setup()
    renderOverview()

    await user.click(await screen.findByRole('button', { name: 'Show getting started' }))
    expect(await screen.findByText('Getting started is not dismissed.')).toBeVisible()
  })

  it('cancels a dismissal without posting anything', async () => {
    let posts = 0
    mockTenant('owner')
    server.use(
      http.post('/api/v1/tenants/acme/onboarding/dismiss', () => {
        posts += 1
        return ok(null, 'Onboarding dismissed.')
      })
    )
    const user = userEvent.setup()
    renderOverview()

    const card = await findCard()
    await user.click(within(card).getByRole('button', { name: 'Dismiss' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' })
    )

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })
    expect(posts).toBe(0)
    expect(await findCard()).toBeInTheDocument()
  })

  it.each(['admin', 'manager', 'editor', 'viewer'] as const)(
    'offers a %s no Dismiss',
    async (role) => {
      mockTenant(role)
      renderOverview()

      const card = await findCard()
      expect(within(card).queryByRole('button', { name: 'Dismiss' })).toBeNull()
    }
  )

  it('shows a non-owner nothing at all while dismissed', async () => {
    mockTenant(
      'admin',
      'member',
      testOnboarding({ state: 'dismissed', dismissedAt: '2026-10-01T09:00:00.000Z' })
    )
    renderOverview()

    await screen.findByRole('heading', { name: 'Overview', level: 2 })
    await onboardingLoaded()
    expect(screen.queryByRole('heading', { name: 'Getting started' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show getting started' })).toBeNull()
  })

  it.each(['owner', 'admin'] as const)(
    'shows staff with platform %s access the checklist read-only',
    async (role) => {
      mockTenant(role, 'platform')
      renderOverview()

      const card = await findCard()
      expect(within(card).getAllByRole('listitem')).toHaveLength(4)
      expect(within(card).queryByRole('button')).toBeNull()
      expect(within(card).queryByRole('link')).toBeNull()
      expect(within(card).queryByText('An owner or admin can do this')).toBeNull()
      // A staff reader has no membership, so the member step reads as not done.
      expect(
        within(stepRow(card, 'Read the getting started guide')).getByText('Not done')
      ).toBeInTheDocument()
    }
  )

  it('says “You’re all set” while the last required step is under a day old', async () => {
    mockTenant(
      'owner',
      'member',
      testOnboarding(
        {
          state: 'complete',
          completedAt: new Date(Date.now() - HOUR_MS).toISOString(),
        },
        ['configure_settings', 'invite_teammate']
      )
    )
    renderOverview()

    expect(
      await screen.findByRole('heading', { name: 'You’re all set', level: 2 })
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Getting started' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
  })

  it.each([
    [
      'complete for over a day',
      testOnboarding({
        state: 'complete',
        completedAt: new Date(Date.now() - 25 * HOUR_MS).toISOString(),
      }),
    ],
    ['not tracked', testOnboarding({ state: 'not_tracked', steps: [] })],
  ])('renders nothing for a tenant %s', async (_name, onboarding) => {
    mockTenant('owner', 'member', onboarding)
    renderOverview()

    await screen.findByRole('heading', { name: 'Overview', level: 2 })
    await onboardingLoaded()
    expect(screen.queryByRole('heading', { name: 'Getting started' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'You’re all set' })).toBeNull()
  })

  it('renders nothing, and leaves the overview working, when the checklist fails to load', async () => {
    let calls = 0
    mockTenant('owner')
    server.use(
      http.get('/api/v1/tenants/acme/onboarding', () => {
        calls += 1
        return fail('Not found', 404)
      })
    )
    renderOverview()

    expect(await screen.findByRole('button', { name: 'Save changes' })).toBeInTheDocument()
    // Two: the query client is `retry: 1`.
    await waitFor(() => {
      expect(calls).toBe(2)
    })
    expect(screen.queryByRole('heading', { name: 'Getting started' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('ticks the settings step after a settings save, without waiting for the cache to go stale', async () => {
    let served = testOnboarding()
    mockTenant('owner')
    server.use(
      http.get('/api/v1/tenants/acme/onboarding', () => ok(served, 'Onboarding retrieved.')),
      http.patch('/api/v1/tenants/acme/settings', () => {
        served = testOnboarding({}, ['configure_settings'])
        return ok({ ...SETTINGS, timezone: 'Europe/Paris' }, 'Settings updated.')
      })
    )
    const user = userEvent.setup()
    renderOverview()

    const card = await findCard()
    await user.click(within(card).getByRole('link', { name: 'Open settings' }))
    await user.click(await screen.findByRole('button', { name: 'Save settings' }))
    await screen.findByText('Settings updated.')

    const tabs = screen.getByRole('navigation', { name: 'Tenant sections' })
    await user.click(within(tabs).getByRole('link', { name: 'Overview' }))
    const after = await findCard()
    await waitFor(() => {
      expect(within(stepRow(after, 'Configure your settings')).getByText('Done')).toBeVisible()
    })
    expect(within(after).getByText('1 of 2 required')).toBeInTheDocument()
  })
})
