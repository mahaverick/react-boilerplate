import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
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
import { BillingBanner } from '@/components/features/billing/billing-banner'
import type { MembershipRole } from '@/constants/roles'
import * as checkoutFlow from '@/hooks/use-checkout-flow'
import { formatBillingDate } from '@/lib/billing-format'
import { toast } from '@/lib/toast'
import * as analytics from '@/observability/telemetry'
import { PII_CLASS_NAME } from '@/observability/telemetry'
import { entitlementsQueryOptions } from '@/queries/billing.queries'
import type { TenantDetail } from '@/queries/tenant.queries'
import { testBilling, testEntitlements } from '@/tests/fixtures/billing'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, tenantDetail } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { TenantAccess } from '@/types/api.types'
import type { TenantBilling } from '@/types/billing.types'

const DAY_MS = 24 * 60 * 60 * 1000

const TENANT = {
  id: TENANT_ID,
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

const BILLING_URL = '/api/v1/tenants/acme/billing'

/** A past-due view: ₹999 a month, failed 1 Nov 20:00 UTC (2 November in Kolkata), grace to 8 Nov. */
const PAST_DUE: Partial<TenantBilling> = {
  state: 'past_due',
  interval: 'month',
  price: { id: 'price-month', interval: 'month', amountMinor: 99900, currency: 'INR' },
  pastDue: {
    since: '2026-11-01T20:00:00.000Z',
    graceEndsAt: '2026-11-08T20:00:00.000Z',
    paused: false,
  },
}

/** Serves acme's detail and billing and the Kolkata time zone; returns the detail the gate would hand over. */
function serve(
  billing: Partial<TenantBilling>,
  role: MembershipRole = 'owner',
  access: TenantAccess = 'member'
): TenantDetail {
  const detail = tenantDetail(TENANT, role, access) as TenantDetail
  server.use(
    http.get('/api/v1/tenants/acme', () => ok(detail, 'Tenant retrieved.')),
    http.get(BILLING_URL, () => ok(testBilling(billing), 'Billing retrieved.')),
    http.get('/api/v1/tenants/acme/settings', () =>
      ok(
        {
          tenantId: TENANT_ID,
          timezone: 'Asia/Kolkata',
          locale: 'en-IN',
          metadata: null,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        'Settings retrieved.'
      )
    )
  )
  return detail
}

/** Mounts the banner for acme on a router of its own; `actions: false` is Billing's sentence-only banner. */
function renderBanner(tenant: TenantDetail, actions = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <BillingBanner slug="acme" tenant={tenant} actions={actions} />,
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return client
}

beforeEach(() => {
  vi.spyOn(toast, 'success')
  vi.spyOn(toast, 'error')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('BillingBanner, past due', () => {
  it('asks an owner to update the card by the grace end, in the tenant’s time zone', async () => {
    renderBanner(serve(PAST_DUE))

    expect(
      await screen.findByText(
        'Your card payment of ₹999 failed on 2 November 2026. Update your card by 9 November 2026 to keep Paid.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update card' })).toBeInTheDocument()
  })

  it('shows the server’s refusal when the card change cannot start', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/v1/tenants/acme/billing/payment-method', () =>
        fail('Only an owner can change the card.', 403, 'FORBIDDEN')
      )
    )
    renderBanner(serve(PAST_DUE))

    await user.click(await screen.findByRole('button', { name: 'Update card' }))
    expect(await screen.findByText('Only an owner can change the card.')).toBeInTheDocument()
  })

  it('tells a member that Paid ends unless an owner acts, with no button', async () => {
    renderBanner(serve(PAST_DUE, 'editor'))

    expect(
      await screen.findByText('Paid ends on 9 November 2026 unless an owner updates the card.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows staff on platform access the member line with no button, even as owner', async () => {
    renderBanner(serve(PAST_DUE, 'owner', 'platform'))

    expect(
      await screen.findByText('Paid ends on 9 November 2026 unless an owner updates the card.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says Razorpay will try again while the grace end is unset', async () => {
    const retrying = { ...PAST_DUE.pastDue!, graceEndsAt: null }
    renderBanner(serve({ ...PAST_DUE, pastDue: retrying }))

    expect(
      await screen.findByText(
        'Your card payment of ₹999 failed on 2 November 2026. Razorpay will try again. Update your card so the next try works.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update card' })).toBeInTheDocument()
  })

  it('tells a member about a retrying payment', async () => {
    const retrying = { ...PAST_DUE.pastDue!, graceEndsAt: null }
    renderBanner(serve({ ...PAST_DUE, pastDue: retrying }, 'viewer'))

    expect(
      await screen.findByText(
        'A card payment failed on 2 November 2026. An owner can update the card.'
      )
    ).toBeInTheDocument()
  })

  it('falls back to an undated line when the failure has no details', async () => {
    renderBanner(serve({ ...PAST_DUE, pastDue: null }))

    expect(
      await screen.findByText('A card payment failed. Update your card to keep Paid.')
    ).toBeInTheDocument()
  })

  it('asks an owner to resume payments paused in the UPI app', async () => {
    const paused = { ...PAST_DUE.pastDue!, paused: true }
    renderBanner(serve({ ...PAST_DUE, pastDue: paused }))

    expect(
      await screen.findByText(
        'Payments are paused in your UPI app. Resume them there by 9 November 2026 to keep Paid.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('tells a member that Paid ends unless an owner resumes payments', async () => {
    const paused = { ...PAST_DUE.pastDue!, paused: true }
    renderBanner(serve({ ...PAST_DUE, pastDue: paused }, 'editor'))

    expect(
      await screen.findByText('Paid ends on 9 November 2026 unless an owner resumes payments.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('BillingBanner, owner actions', () => {
  it('replaces “Update card” with a line when payments are off', async () => {
    renderBanner(serve({ ...PAST_DUE, paymentsEnabled: false }))

    expect(await screen.findByText('Payments aren’t set up yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('replaces “Use my card” with a line when payments are off', async () => {
    renderBanner(
      serve({
        state: 'active',
        currentPeriodEnd: '2026-11-01T18:30:00.000Z',
        payer: { userId: 'user-2', name: 'Priya Shah', isMember: false },
        paymentsEnabled: false,
      })
    )

    expect(await screen.findByText('Payments aren’t set up yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows the checkout flow’s message while it waits', async () => {
    vi.spyOn(checkoutFlow, 'useCheckoutFlow').mockReturnValue({
      start: vi.fn(async () => {}),
      status: 'waiting',
      message: 'Card received. We’re confirming it with Razorpay.',
    })
    renderBanner(serve(PAST_DUE))

    expect(
      await screen.findByText('Card received. We’re confirming it with Razorpay.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update card' })).toBeEnabled()
  })
})

describe('BillingBanner, payer left', () => {
  const PAYER_LEFT: Partial<TenantBilling> = {
    state: 'active',
    interval: 'month',
    currentPeriodEnd: '2026-11-01T18:30:00.000Z',
    payer: { userId: 'user-2', name: 'Priya Shah', isMember: false },
  }

  it('names the payer inside <Pii> and offers an owner “Use my card”', async () => {
    renderBanner(serve(PAYER_LEFT))

    const name = await screen.findByText('Priya Shah')
    for (const className of PII_CLASS_NAME.split(' ')) expect(name).toHaveClass(className)
    expect(name.parentElement).toHaveTextContent(
      'Billing uses Priya Shah’s card, and they left the workspace. Add your card by 2 November 2026 to keep Paid.'
    )
    expect(screen.getByRole('button', { name: 'Use my card' })).toBeInTheDocument()
  })

  it('names no one when the payer’s name is empty', async () => {
    renderBanner(serve({ ...PAYER_LEFT, payer: { userId: 'user-2', name: '', isMember: false } }))

    expect(
      await screen.findByText(
        'Billing uses the card of a former member, who left the workspace. Add your card by 2 November 2026 to keep Paid.'
      )
    ).toBeInTheDocument()
  })

  it('tells a member that Paid ends unless an owner adds a card', async () => {
    renderBanner(serve(PAYER_LEFT, 'admin'))

    expect(
      await screen.findByText('Paid ends on 2 November 2026 unless an owner adds a card.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('BillingBanner, trial', () => {
  it('links an owner to Upgrade when the trial ends within 3 days', async () => {
    const trialEndsAt = new Date(Date.now() + 2 * DAY_MS).toISOString()
    renderBanner(serve({ state: 'trialing', trialEndsAt }))

    expect(await screen.findByText(/^Your Paid trial ends on /)).toHaveTextContent(
      'After that you’re on Free, and nothing is deleted.'
    )
    expect(await screen.findByRole('link', { name: 'Upgrade' })).toBeInTheDocument()
  })

  it('offers a member “Request upgrade” instead', async () => {
    const trialEndsAt = new Date(Date.now() + 2 * DAY_MS).toISOString()
    renderBanner(serve({ state: 'trialing', trialEndsAt }, 'editor'))

    expect(await screen.findByRole('button', { name: 'Request upgrade' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Upgrade' })).toBeNull()
  })

  it('counts the days left in a running trial, with no button', async () => {
    // An hour short of 9 days, so the shared clock's lag (up to one tick) cannot round it to 10.
    const trialEndsAt = new Date(Date.now() + 9 * DAY_MS - 60 * 60 * 1000).toISOString()
    renderBanner(serve({ state: 'trialing', trialEndsAt }))

    expect(await screen.findByText(/^9 days left in your Paid trial\. Ends /)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('BillingBanner, trial ended', () => {
  /** A trial end a day before the call. */
  const trialEndsAt = () => new Date(Date.now() - DAY_MS).toISOString()

  it('posts the dismissal, tracks it and hides the banner', async () => {
    const track = vi.spyOn(analytics, 'track')
    const user = userEvent.setup()
    const bodies: unknown[] = []
    server.use(
      http.post('/api/v1/tenants/acme/banner-dismissals', async ({ request }) => {
        bodies.push(await request.json())
        return ok(null, 'Banner dismissed.')
      })
    )
    const tenant = serve({ state: 'free', trialEndsAt: trialEndsAt() }, 'viewer')
    renderBanner(tenant)

    expect(
      await screen.findByText(/^Your trial ended on .+\. You’re on Free\.$/)
    ).toBeInTheDocument()
    server.use(
      http.get(BILLING_URL, () =>
        ok(
          testBilling({
            state: 'free',
            trialEndsAt: trialEndsAt(),
            dismissedBanners: ['trial_ended'],
          }),
          'Billing retrieved.'
        )
      )
    )
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))

    await waitFor(() => expect(screen.queryByText(/^Your trial ended on /)).toBeNull())
    expect(bodies).toEqual([{ banner: 'trial_ended' }])
    expect(track).toHaveBeenCalledWith('banner_dismissed', { banner: 'trial_ended' })
  })

  it('tracks the dismissal though the banner is gone before the follow-up reads finish', async () => {
    const track = vi.spyOn(analytics, 'track')
    const user = userEvent.setup()
    const client = renderBanner(serve({ state: 'free', trialEndsAt: trialEndsAt() }))
    // Most tenant pages watch the entitlements too (meters, gates), so the dismissal's invalidation waits on them.
    const entitlements = new QueryObserver(client, entitlementsQueryOptions('acme'))
    const unsubscribe = entitlements.subscribe(() => {})
    await waitFor(() => expect(entitlements.getCurrentResult().isSuccess).toBe(true))
    await screen.findByRole('button', { name: 'Dismiss' })

    // The billing refetch says dismissed, so the banner unmounts; the entitlements refetch hangs, as on a slow network.
    /** Lets the held request answer; replaced below. */
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.post('/api/v1/tenants/acme/banner-dismissals', () => ok(null, 'Banner dismissed.')),
      http.get(BILLING_URL, () =>
        ok(
          testBilling({
            state: 'free',
            trialEndsAt: trialEndsAt(),
            dismissedBanners: ['trial_ended'],
          }),
          'Billing retrieved.'
        )
      ),
      http.get('/api/v1/tenants/acme/entitlements', async () => {
        await held
        return ok(testEntitlements(), 'Entitlements retrieved.')
      })
    )
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.queryByText(/^Your trial ended on /)).toBeNull())
    release()

    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('banner_dismissed', { banner: 'trial_ended' })
    )
    unsubscribe()
  })

  it('keeps the banner and shows the server’s message when the dismissal fails', async () => {
    const track = vi.spyOn(analytics, 'track')
    const user = userEvent.setup()
    server.use(
      http.post('/api/v1/tenants/acme/banner-dismissals', () =>
        fail('Too many requests. Try again in a minute.', 429, 'RATE_LIMITED')
      )
    )
    renderBanner(serve({ state: 'free', trialEndsAt: trialEndsAt() }))

    await user.click(await screen.findByRole('button', { name: 'Dismiss' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Too many requests. Try again in a minute.')
    )
    expect(await screen.findByRole('button', { name: 'Dismiss' })).toBeEnabled()
    expect(screen.getByText(/^Your trial ended on /)).toBeInTheDocument()
    expect(track).not.toHaveBeenCalledWith('banner_dismissed', { banner: 'trial_ended' })
  })

  it('opens the trial summary from “See what changed”, dated in the tenant’s time zone', async () => {
    const user = userEvent.setup()
    // 20:00 UTC yesterday is already today in Kolkata, so a UTC date would name the wrong day.
    const ended = new Date(Date.now() - DAY_MS)
    ended.setUTCHours(20, 0, 0, 0)
    const iso = ended.toISOString()
    renderBanner(serve({ state: 'free', trialEndsAt: iso }, 'viewer'))

    await user.click(await screen.findByRole('button', { name: 'See what changed' }))

    expect(
      await screen.findByRole('dialog', {
        name: `Your trial ended on ${formatBillingDate(iso, 'Asia/Kolkata')}`,
      })
    ).toBeInTheDocument()
    expect(formatBillingDate(iso, 'Asia/Kolkata')).not.toBe(formatBillingDate(iso, 'UTC'))
  })

  it('gives staff on platform access no Dismiss', async () => {
    renderBanner(serve({ state: 'free', trialEndsAt: trialEndsAt() }, 'owner', 'platform'))

    expect(await screen.findByText(/^Your trial ended on /)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
  })
})

describe('BillingBanner, without actions (on Billing)', () => {
  it('keeps the past-due sentence but offers no card button', async () => {
    renderBanner(serve(PAST_DUE), false)
    expect(
      await screen.findByText(
        'Your card payment of ₹999 failed on 2 November 2026. Update your card by 9 November 2026 to keep Paid.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('keeps the trial-ending sentence but no Upgrade link', async () => {
    renderBanner(serve({ trialEndsAt: new Date(Date.now() + 2 * DAY_MS).toISOString() }), false)
    expect(await screen.findByText(/^Your Paid trial ends on /)).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('keeps the trial summary and Dismiss after the trial ended', async () => {
    renderBanner(
      serve({ state: 'free', trialEndsAt: new Date(Date.now() - DAY_MS).toISOString() }),
      false
    )
    expect(await screen.findByRole('button', { name: 'See what changed' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
  })
})

describe('BillingBanner, nothing to say', () => {
  it('renders nothing for an active workspace whose payer is a member', async () => {
    let read = false
    const detail = serve({
      state: 'active',
      payer: { userId: 'user-2', name: 'Priya Shah', isMember: true },
    })
    server.use(
      http.get(BILLING_URL, () => {
        read = true
        return ok(
          testBilling({
            state: 'active',
            payer: { userId: 'user-2', name: 'Priya Shah', isMember: true },
          }),
          'Billing retrieved.'
        )
      })
    )
    renderBanner(detail)

    await waitFor(() => expect(read).toBe(true))
    await settle(
      50,
      'the banner renders after the billing read; nothing marks that it chose to stay empty'
    )
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('reads no billing for the platform tenant', async () => {
    let read = false
    const detail = { ...serve({}), isPlatform: true }
    server.use(
      http.get('/api/v1/tenants/acme', () => ok(detail, 'Tenant retrieved.')),
      http.get(BILLING_URL, () => {
        read = true
        return ok(testBilling(), 'Billing retrieved.')
      })
    )
    renderBanner(detail)

    await settle(50, 'a request that is never sent has no event to wait on')
    expect(read).toBe(false)
    expect(screen.queryByText(/days left/)).toBeNull()
  })
})
