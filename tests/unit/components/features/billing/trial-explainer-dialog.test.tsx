import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { TrialExplainerDialog } from '@/components/features/billing/trial-explainer-dialog'
import type { MembershipRole } from '@/constants/roles'
import * as analytics from '@/observability/telemetry'
import type { TenantDetail } from '@/queries/tenant.queries'
import { testBilling } from '@/tests/fixtures/billing'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { settle } from '@/tests/fixtures/timing'
import { ok, tenantDetail } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { TenantAccess } from '@/types/api.types'
import type { TenantBilling } from '@/types/billing.types'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const KEY = `billing.trial-explainer.${TENANT_ID}`

/**
 * A tenant's creation and its 14-day trial's end.
 * @param createdAgoMs - How long ago the tenant was created; an hour by default.
 */
function newTenant(createdAgoMs = HOUR_MS) {
  const createdAt = Date.now() - createdAgoMs
  return {
    createdAt: new Date(createdAt).toISOString(),
    trialEndsAt: new Date(createdAt + 14 * DAY_MS).toISOString(),
  }
}

/** The trial end's date in Kolkata, as the dialog writes it. */
function kolkataDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso))
}

/** Serves acme's detail, billing and Kolkata settings; returns the detail the page would hand over. */
function serve(
  createdAt: string,
  billing: Partial<TenantBilling>,
  role: MembershipRole = 'owner',
  access: TenantAccess = 'member'
): TenantDetail {
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
      createdAt,
      updatedAt: createdAt,
    },
    role,
    access
  ) as TenantDetail
  server.use(
    http.get('/api/v1/tenants/acme', () => ok(detail, 'Tenant retrieved.')),
    http.get('/api/v1/tenants/acme/billing', () => ok(testBilling(billing), 'Billing retrieved.')),
    http.get('/api/v1/tenants/acme/settings', () =>
      ok(
        {
          tenantId: TENANT_ID,
          timezone: 'Asia/Kolkata',
          locale: 'en-IN',
          metadata: null,
          updatedAt: createdAt,
        },
        'Settings retrieved.'
      )
    )
  )
  return detail
}

/** Mounts the explainer for acme on a router of its own; returns a function that unmounts it. */
function renderExplainer(tenant: TenantDetail) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <TrialExplainerDialog slug="acme" tenant={tenant} />,
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return { client, unmount: view.unmount }
}

/**
 * Waits until the explainer had all it reads (billing and settings), so a
 * negative check runs after the moment it would have opened.
 */
async function settled(client: QueryClient) {
  await waitFor(() =>
    expect(client.getQueryState(['tenants', 'acme', 'billing'])?.status).toBe('success')
  )
  await settle(
    50,
    'the dialog opens on a render after the reads; nothing marks that it stayed shut'
  )
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('TrialExplainerDialog', () => {
  it('explains the trial once, tracks it, and stays shut after “Got it”', async () => {
    const track = vi.spyOn(analytics, 'track')
    const user = userEvent.setup()
    const { createdAt, trialEndsAt } = newTenant()
    const tenant = serve(createdAt, { state: 'trialing', trialEndsAt })
    const first = renderExplainer(tenant)

    const dialog = await screen.findByRole('dialog', { name: 'You’re on a 14-day Paid trial' })
    expect(dialog).toHaveTextContent(
      `Everything in Paid is on until ${kolkataDate(trialEndsAt)}. Then you move to Free. Nothing is deleted, and no card is needed.`
    )
    expect(track).toHaveBeenCalledWith('trial_explainer_viewed')
    expect(track).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(localStorage.getItem(KEY)).not.toBeNull()
    first.unmount()

    const second = renderExplainer(tenant)
    await settled(second.client)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows nothing when storage cannot be read', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    const { createdAt, trialEndsAt } = newTenant()
    const { client } = renderExplainer(serve(createdAt, { state: 'trialing', trialEndsAt }))

    await settled(client)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on “Got it” when storage cannot be written', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const user = userEvent.setup()
    const { createdAt, trialEndsAt } = newTenant()
    renderExplainer(serve(createdAt, { state: 'trialing', trialEndsAt }))

    await user.click(await screen.findByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it.each<[string, () => TenantDetail]>([
    [
      'a workspace older than a day',
      () => {
        const { createdAt, trialEndsAt } = newTenant(25 * HOUR_MS)
        return serve(createdAt, { state: 'trialing', trialEndsAt })
      },
    ],
    [
      'a workspace not in its trial',
      () => serve(newTenant().createdAt, { state: 'free', trialEndsAt: null }),
    ],
    [
      'staff on platform access',
      () => {
        const { createdAt, trialEndsAt } = newTenant()
        return serve(createdAt, { state: 'trialing', trialEndsAt }, 'owner', 'platform')
      },
    ],
  ])('shows nothing for %s', async (_name, tenant) => {
    const { client } = renderExplainer(tenant())

    await settled(client)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
