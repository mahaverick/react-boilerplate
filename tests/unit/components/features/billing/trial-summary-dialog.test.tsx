import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { TrialSummaryDialog } from '@/components/features/billing/trial-summary-dialog'
import type { MembershipRole } from '@/constants/roles'
import * as analytics from '@/observability/telemetry'
import { testEntitlements, testPlans } from '@/tests/fixtures/billing'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { fail, ok, tenantDetail } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { TenantAccess } from '@/types/api.types'

/** The entitlements after the trial: Free's 3 members, 5 in use, Insights off. */
const AFTER_TRIAL = testEntitlements({
  plan: { key: 'free', name: 'Free' },
  state: 'free',
  features: { advanced_example: false },
  limits: { members: { limit: 3, used: 5, approaching: false } },
})

/** Serves acme's detail for the viewer and the post-trial entitlements. */
function serve(role: MembershipRole = 'owner', access: TenantAccess = 'member') {
  const detail = tenantDetail(
    {
      id: TENANT_ID,
      name: 'Acme Corp',
      slug: 'acme',
      description: null,
      logo: null,
      website: null,
      lifecycleState: 'active',
      deletedAt: null,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    },
    role,
    access
  )
  server.use(
    http.get('/api/v1/tenants/acme', () => ok(detail, 'Tenant retrieved.')),
    http.get('/api/v1/tenants/acme/entitlements', () => ok(AFTER_TRIAL, 'Entitlements retrieved.'))
  )
}

/** Mounts the summary's button for acme on a router of its own. */
function renderSummary(upgrade = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <TrialSummaryDialog slug="acme" trialEndedOn="2 November 2026" upgrade={upgrade} />
      ),
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
}

/** Opens the summary and returns it once its lines or its message have loaded. */
async function open(ready: string) {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'See what changed' }))
  const dialog = await screen.findByRole('dialog', { name: 'Your trial ended on 2 November 2026' })
  await within(dialog).findByText(ready)
  return { dialog, user }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TrialSummaryDialog', () => {
  it('lists what changes on Free, tracks the view and offers an owner Upgrade', async () => {
    const track = vi.spyOn(analytics, 'track')
    serve()
    renderSummary()

    const { dialog, user } = await open('5 members (Free allows 3)')
    expect(within(dialog).getByText('On Free, these change:')).toBeInTheDocument()
    expect(
      within(dialog)
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    ).toEqual(['5 members (Free allows 3)', 'Insights (Paid only)'])
    expect(track).toHaveBeenCalledWith('trial_summary_viewed')
    expect(await within(dialog).findByRole('link', { name: 'Upgrade' })).toHaveAttribute(
      'href',
      '/settings/workspace/acme/billing'
    )

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('tracks trial_summary_viewed exactly once per opening', async () => {
    const track = vi.spyOn(analytics, 'track')
    serve()
    renderSummary()

    const { dialog } = await open('5 members (Free allows 3)')
    // The footer's Upgrade loads after the lines; its mount is the last render that could track again.
    await within(dialog).findByRole('link', { name: 'Upgrade' })
    expect(track.mock.calls.filter(([event]) => event === 'trial_summary_viewed')).toHaveLength(1)
  })

  it('offers Close only with upgrade={false}, as on Billing, and tracks no upgrade prompt', async () => {
    const track = vi.spyOn(analytics, 'track')
    serve()
    renderSummary(false)

    const { dialog } = await open('5 members (Free allows 3)')
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('link', { name: 'Upgrade' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Request upgrade' })).toBeNull()
    expect(track).not.toHaveBeenCalledWith('upgrade_prompt_viewed', expect.anything())
  })

  it('offers a member “Request upgrade”', async () => {
    serve('editor')
    renderSummary()

    const { dialog } = await open('5 members (Free allows 3)')
    expect(await within(dialog).findByRole('button', { name: 'Request upgrade' })).toBeEnabled()
    expect(within(dialog).queryByRole('link', { name: 'Upgrade' })).toBeNull()
  })

  it('offers staff on platform access no upgrade', async () => {
    serve('owner', 'platform')
    renderSummary()

    const { dialog } = await open('5 members (Free allows 3)')
    expect(within(dialog).queryByRole('link', { name: 'Upgrade' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Request upgrade' })).toBeNull()
  })

  it('says nothing changes when usage fits Free and Paid has no feature Free lacks', async () => {
    serve()
    server.use(
      http.get('/api/v1/plans', () =>
        ok(
          {
            ...testPlans,
            plans: testPlans.plans.map((plan) => ({
              ...plan,
              entitlements: { ...plan.entitlements, advanced_example: true },
            })),
          },
          'Plans retrieved.'
        )
      ),
      http.get('/api/v1/tenants/acme/entitlements', () =>
        ok(
          { ...AFTER_TRIAL, limits: { members: { limit: 3, used: 2, approaching: false } } },
          'Entitlements retrieved.'
        )
      )
    )
    renderSummary()

    const { dialog } = await open('Nothing changes for you on Free.')
    expect(within(dialog).queryByText('On Free, these change:')).toBeNull()
    expect(within(dialog).queryByRole('list')).toBeNull()
  })

  it('says the list didn’t load when the entitlements fail, and retries', async () => {
    serve()
    server.use(
      http.get('/api/v1/tenants/acme/entitlements', () =>
        fail('Something went wrong.', 500, 'INTERNAL_ERROR')
      )
    )
    renderSummary()

    const { dialog, user } = await open('What changes didn’t load. Try again.')
    server.use(
      http.get('/api/v1/tenants/acme/entitlements', () =>
        ok(AFTER_TRIAL, 'Entitlements retrieved.')
      )
    )
    await user.click(within(dialog).getByRole('button', { name: /try again/i }))
    expect(await within(dialog).findByText('5 members (Free allows 3)')).toBeInTheDocument()
  })
})
