import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vite-plus/test'
import type { MembershipRole } from '@/constants/roles'
import { resetSessionForTests } from '@/http/session'
import type { RazorpayOptions } from '@/lib/razorpay-checkout'
import { toast } from '@/lib/toast'
import * as analytics from '@/observability/telemetry'
import { PII_CLASS_NAME } from '@/observability/telemetry'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { useCurrentTenantStore } from '@/states/current-tenant.store'
import { testUpgradeRequest } from '@/tests/fixtures/billing'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import {
  fail,
  ok,
  tenantDetail,
  testBilling,
  testEntitlements,
  testPlans,
  testUser,
} from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { type TenantAccess } from '@/types/api.types'
import { SWITCH_TOO_CLOSE_TO_RENEWAL } from '@/types/billing.types'
import type { InvoiceView, PriceView, TenantBilling } from '@/types/billing.types'

const PATH = '/settings/workspace/acme/billing'
const BASE = '/api/v1/tenants/acme'

/** Midnight IST on 3 November: still 2 November in UTC. Far ahead, so "before the first charge" holds whatever today is. */
const PERIOD_END = '2099-11-02T18:30:00.000Z'
const TRIAL_END = '2099-11-05T18:30:00.000Z'
const SINCE = '2026-10-20T09:00:00.000Z'
const MONTHLY: PriceView = {
  id: 'price_month',
  interval: 'month',
  amountMinor: 99_900,
  currency: 'INR',
}

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

/** Serves acme with the caller holding `role` through `access`, and its billing view. */
function mockTenant(
  role: MembershipRole,
  billing: TenantBilling | null = testBilling({ trialEndsAt: TRIAL_END }),
  access: TenantAccess = 'member'
) {
  server.use(
    http.get('/api/v1/tenants', () =>
      ok(
        listPage([
          {
            tenant: { ...TENANT, isPlatform: false },
            role,
            isPlatform: false,
            joinedAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
        'Tenants retrieved.'
      )
    ),
    http.get(BASE, () => ok(tenantDetail(TENANT, role, access), 'Tenant retrieved.')),
    http.get(`${BASE}/billing`, () =>
      billing === null ? fail('Not found.', 404) : ok(billing, 'Billing retrieved.')
    )
  )
}

/** An active monthly subscription renewing at `PERIOD_END`, paid with Ada's card. */
function active(overrides: Partial<TenantBilling> = {}): TenantBilling {
  return testBilling({
    state: 'active',
    interval: 'month',
    price: MONTHLY,
    trialEndsAt: null,
    currentPeriodEnd: PERIOD_END,
    payer: { userId: testUser.id, name: 'Ada Lovelace', isMember: true },
    billingEmail: 'billing@acme.test',
    ...overrides,
  })
}

/** Counts the requests to `path` (a GET), answering each with `answer`. */
function countGets(path: string, answer: () => Response) {
  const calls = { count: 0 }
  server.use(
    http.get(path, () => {
      calls.count += 1
      return answer()
    })
  )
  return calls
}

/** One invoice row. */
function invoice(overrides: Partial<InvoiceView> = {}): InvoiceView {
  return {
    id: 'inv_1',
    amountMinor: 99_900,
    currency: 'INR',
    status: 'paid',
    issuedAt: '2026-10-02T18:30:00.000Z',
    paidAt: '2026-10-02T18:31:00.000Z',
    url: 'https://rzp.io/i/abc',
    ...overrides,
  }
}

/** Mounts the real route tree at the billing page. */
function renderBilling(path = PATH) {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
    ...ROUTER_DEFAULTS,
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return router
}

/** The overview card, once its state line has loaded. */
async function overview() {
  const heading = await screen.findByRole('heading', { level: 2, name: 'Plan' })
  const card = heading.closest('[data-slot="card"]')
  if (!(card instanceof HTMLElement)) throw new Error('No overview card.')
  return card
}

/** A stand-in for Razorpay's constructor: Checkout "opens" and does nothing. */
class FakeRazorpay {
  /** Records the options. */
  constructor(options: RazorpayOptions) {
    opened.push(options)
  }

  /** Opening shows nothing under jsdom. */
  open() {}

  /** Closing needs no record. */
  close() {}

  /** No listener is driven here. */
  on() {}
}

let opened: RazorpayOptions[] = []
let track: MockInstance<typeof analytics.track>

beforeEach(() => {
  opened = []
  window.Razorpay = FakeRazorpay
  resetSessionForTests()
  queryClient.clear()
  localStorage.clear()
  useCurrentTenantStore.setState({ remembered: {} })
  useAuthStore.setState({
    accessToken: 'access-token',
    user: testUser,
    isAuthenticated: true,
    isBootstrapped: true,
  })
  track = vi.spyOn(analytics, 'track')
  vi.spyOn(toast, 'success')
  vi.spyOn(toast, 'error')
})

afterEach(() => {
  vi.restoreAllMocks()
  delete window.Razorpay
  for (const script of document.querySelectorAll('script[src*="checkout.razorpay.com"]')) {
    script.remove()
  }
})

describe('billing page, overview', () => {
  it('titles the page Billing and tracks the view once', async () => {
    mockTenant('owner')
    renderBilling()
    await overview()
    expect(screen.getByRole('heading', { level: 1, name: 'Billing' })).toBeInTheDocument()
    expect(track.mock.calls.filter(([event]) => event === 'billing_page_viewed')).toEqual([
      ['billing_page_viewed'],
    ])
  })

  it.each([
    ['trialing', testBilling({ trialEndsAt: TRIAL_END }), 'Paid trial · Ends 5 November 2099'],
    [
      'free',
      testBilling({ state: 'free', plan: { key: 'free', name: 'Free' }, trialEndsAt: null }),
      undefined,
    ],
    ['active monthly', active(), 'Paid · ₹999 per month · Renews 2 November 2099'],
    [
      'active cancelling',
      active({ cancelAtPeriodEnd: true }),
      'Paid · Ends 2 November 2099. You won’t be charged again.',
    ],
    [
      'past due',
      active({ state: 'past_due', pastDue: { since: SINCE, graceEndsAt: null, paused: false } }),
      'Paid · Payment failed on 20 October 2026',
    ],
    [
      'paused',
      active({ state: 'past_due', pastDue: { since: SINCE, graceEndsAt: null, paused: true } }),
      'Paid · Payments paused on 20 October 2026',
    ],
    [
      'active before the first charge',
      active({ trialEndsAt: TRIAL_END, currentPeriodEnd: TRIAL_END }),
      'Paid · First charge of ₹999 on 5 November 2099',
    ],
    [
      'switch scheduled',
      active({ cancelAtPeriodEnd: true, nextSwitch: { interval: 'year', startsAt: PERIOD_END } }),
      'Paid · ₹9,990 per year from 2 November 2099',
    ],
  ])('reads the %s state line', async (_case, billing, line) => {
    mockTenant('owner', billing)
    renderBilling()
    const card = await overview()
    // "Free" is also the plan's name, so the state line is found by its slot.
    await waitFor(() =>
      expect(card.querySelector('[data-slot="billing-state"]')?.textContent).toBe(line)
    )
  })

  it('names Free once, with no state line under it', async () => {
    mockTenant(
      'owner',
      testBilling({ state: 'free', plan: { key: 'free', name: 'Free' }, trialEndsAt: null })
    )
    renderBilling()
    const card = await overview()
    await within(card).findByText('Free', { exact: true })
    expect(within(card).getAllByText('Free', { exact: true })).toHaveLength(1)
    expect(card.querySelector('[data-slot="billing-state"]')).toBeNull()
  })

  it.each([
    ['active', active()],
    ['cancelling', active({ cancelAtPeriodEnd: true })],
    [
      'past due',
      active({ state: 'past_due', pastDue: { since: SINCE, graceEndsAt: null, paused: false } }),
    ],
    [
      'paused',
      active({ state: 'past_due', pastDue: { since: SINCE, graceEndsAt: null, paused: true } }),
    ],
  ])('names the payer and the receipts address while Paid is %s', async (_case, billing) => {
    mockTenant('owner', billing)
    renderBilling()
    const card = await overview()
    expect(await within(card).findByText(/^Receipts go to/)).toBeInTheDocument()
    expect(within(card).getByText(/^Paid with/)).toBeInTheDocument()
  })

  it.each([
    [
      'Free, after a cancelled subscription',
      active({ state: 'free', plan: { key: 'free', name: 'Free' }, interval: null, price: null }),
    ],
    [
      'the trial, after an abandoned checkout',
      active({ state: 'trialing', trialEndsAt: TRIAL_END }),
    ],
  ])('names no payer or receipts address on %s', async (_case, billing) => {
    mockTenant('owner', billing)
    renderBilling()
    const card = await overview()
    await within(card).findAllByText(billing.plan.name, { exact: true })
    expect(within(card).queryByText(/Receipts go to/)).toBeNull()
    expect(within(card).queryByText(/^Paid with/)).toBeNull()
  })

  it('dates in the tenant’s time zone', async () => {
    mockTenant('owner', active())
    server.use(
      http.get(`${BASE}/settings`, () =>
        ok(
          {
            tenantId: TENANT_ID,
            timezone: 'Asia/Kolkata',
            locale: 'en',
            metadata: null,
            updatedAt: SINCE,
          },
          'Settings retrieved.'
        )
      )
    )
    renderBilling()
    const card = await overview()
    expect(
      await within(card).findByText('Paid · ₹999 per month · Renews 3 November 2099')
    ).toBeInTheDocument()
  })

  it('meters each limit and lists each feature, with the catalog’s labels', async () => {
    mockTenant('owner')
    server.use(
      http.get(`${BASE}/entitlements`, () =>
        ok(
          {
            plan: { key: 'free', name: 'Free' },
            state: 'free',
            trialEndsAt: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            pastDue: null,
            features: { advanced_example: false },
            limits: { members: { limit: 3, used: 2, approaching: true } },
          },
          'Entitlements retrieved.'
        )
      )
    )
    renderBilling()
    const card = await overview()
    expect(await within(card).findByRole('meter', { name: 'Members' })).toHaveAttribute(
      'aria-valuetext',
      '2 of 3 members'
    )
    expect(
      within(card).getByRole('listitem', { name: 'Insights: not included' })
    ).toBeInTheDocument()
  })

  it('names the payer and the receipts address, masked for analytics', async () => {
    mockTenant('owner', active())
    renderBilling()
    const card = await overview()
    expect(await within(card).findByText('Ada Lovelace')).toHaveClass(PII_CLASS_NAME)
    expect(within(card).getByText('billing@acme.test')).toHaveClass(PII_CLASS_NAME)
  })

  it('links to the plans on the pricing page, naming this workspace', async () => {
    mockTenant('owner', active())
    renderBilling()
    await overview()
    expect(screen.getByRole('link', { name: 'Compare plans' })).toHaveAttribute(
      'href',
      '/pricing?tenant=acme'
    )
  })

  it('says the platform workspace has no billing, and asks for none', async () => {
    const reads = countGets(`/api/v1/tenants/platform/billing`, () => ok(testBilling()))
    server.use(
      http.get('/api/v1/tenants/platform', () =>
        ok(
          {
            ...tenantDetail({ ...TENANT, slug: 'platform', name: 'Platform' }, 'owner'),
            isPlatform: true,
          },
          'Tenant retrieved.'
        )
      )
    )
    renderBilling('/settings/workspace/platform/billing')
    expect(await screen.findByText('The platform workspace has no billing.')).toBeInTheDocument()
    expect(reads.count).toBe(0)
  })
})

describe('billing page, owner actions by state', () => {
  it('offers Paid in the trial, with the hold note and no subscription actions', async () => {
    mockTenant('owner')
    renderBilling()
    const card = await overview()
    expect(await within(card).findByRole('button', { name: 'Upgrade to Paid' })).toBeInTheDocument()
    expect(within(card).getByText('₹999 per month')).toBeInTheDocument()
    expect(
      within(card).getByText(
        'We’ll hold ₹5 on your card now and refund it. Your first charge of ₹999 is on 5 November 2099.'
      )
    ).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Cancel Paid' })).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Update card' })).toBeNull()
  })

  it('offers Paid on Free without the trial note', async () => {
    mockTenant(
      'owner',
      testBilling({ state: 'free', plan: { key: 'free', name: 'Free' }, trialEndsAt: null })
    )
    renderBilling()
    const card = await overview()
    expect(await within(card).findByRole('button', { name: 'Upgrade to Paid' })).toBeInTheDocument()
    expect(within(card).queryByText(/We’ll hold ₹5/)).toBeNull()
  })

  it('shows the yearly price with its saving, and starts checkout with the chosen interval', async () => {
    const bodies: unknown[] = []
    server.use(
      http.post(`${BASE}/billing/checkout`, async ({ request }) => {
        bodies.push(await request.json())
        return new Promise<Response>(() => {})
      })
    )
    mockTenant('owner')
    const user = userEvent.setup()
    renderBilling()
    const card = await overview()
    await user.click(await within(card).findByRole('button', { name: 'Yearly' }))
    expect(within(card).getByRole('button', { name: 'Yearly' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(
      within(card).getByText('₹9,990 per year · ₹833 a month · 2 months free')
    ).toBeInTheDocument()
    expect(track).toHaveBeenCalledWith('interval_selected', { interval: 'year' })

    await user.click(within(card).getByRole('button', { name: 'Upgrade to Paid' }))
    await waitFor(() => expect(bodies).toEqual([{ interval: 'year' }]))
  })

  it('keeps Upgrade to Paid disabled while a taken payment waits to be confirmed', async () => {
    const starts: unknown[] = []
    server.use(
      http.post(`${BASE}/billing/checkout`, async ({ request }) => {
        starts.push(await request.json())
        return ok(
          {
            purpose: 'upgrade',
            keyId: 'rzp_test_key',
            subscriptionId: 'sub_1',
            amountMinor: 99_900,
            currency: 'INR',
            interval: 'month',
            startsAt: null,
            prefill: { name: 'Ada Lovelace', email: testUser.email },
          },
          'Checkout started.',
          201
        )
      }),
      http.post(`${BASE}/billing/checkout/confirm`, () => fail('Internal server error.', 500))
    )
    mockTenant('owner')
    const user = userEvent.setup()
    renderBilling()
    const card = await overview()
    await user.click(await within(card).findByRole('button', { name: 'Upgrade to Paid' }))
    await waitFor(() => expect(opened).toHaveLength(1))

    act(() => {
      opened[0]?.handler({
        razorpay_payment_id: 'pay_1',
        razorpay_subscription_id: 'sub_1',
        razorpay_signature: 'signature',
      })
    })

    expect(
      await within(card).findByText(
        'Payment received. We’re confirming it. This page updates when it’s done.'
      )
    ).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Upgrade to Paid' })).toBeDisabled()
    expect(starts).toHaveLength(1)
  })

  it('keeps Keep Paid, Switch and Update card disabled while a switch waits to be confirmed', async () => {
    server.use(
      http.post(`${BASE}/billing/interval`, () =>
        ok(
          {
            purpose: 'switch',
            keyId: 'rzp_test_key',
            subscriptionId: 'sub_2',
            amountMinor: 999_000,
            currency: 'INR',
            interval: 'year',
            startsAt: PERIOD_END,
            prefill: { name: 'Ada Lovelace', email: testUser.email },
          },
          'Switch started.',
          201
        )
      ),
      http.post(`${BASE}/billing/checkout/confirm`, () => fail('Internal server error.', 500))
    )
    mockTenant('owner', active())
    const user = userEvent.setup()
    renderBilling()
    const card = await overview()
    await user.click(await within(card).findByRole('button', { name: 'Switch to yearly' }))
    await waitFor(() => expect(opened).toHaveLength(1))
    act(() => {
      opened[0]?.handler({
        razorpay_payment_id: 'pay_1',
        razorpay_subscription_id: 'sub_2',
        razorpay_signature: 'signature',
      })
    })
    expect(
      await within(card).findByText(
        'Payment received. We’re confirming it. This page updates when it’s done.'
      )
    ).toBeInTheDocument()
    // A second checkout would end the switch's wait, so neither starts one.
    expect(within(card).getByRole('button', { name: 'Switch to yearly' })).toBeDisabled()
    expect(within(card).getByRole('button', { name: 'Update card' })).toBeDisabled()

    // A cancel lands before the webhook records the switch, so the plan choice shows.
    act(() => {
      queryClient.setQueryData(['tenants', 'acme', 'billing'], active({ cancelAtPeriodEnd: true }))
    })

    expect(
      await within(card).findByRole('button', { name: 'Keep Paid after 2 November 2099' })
    ).toBeDisabled()
  })

  it('leaves Keep Paid, Switch and Update card enabled while only a card change waits', async () => {
    server.use(
      http.post(`${BASE}/billing/payment-method`, () =>
        ok(
          {
            purpose: 'card_change',
            keyId: 'rzp_test_key',
            subscriptionId: 'sub_1',
            amountMinor: 99_900,
            currency: 'INR',
            interval: 'month',
            startsAt: null,
            prefill: { name: 'Ada Lovelace', email: testUser.email },
          },
          'Card change started.',
          201
        )
      ),
      http.post(`${BASE}/billing/checkout/confirm`, () => fail('Internal server error.', 500))
    )
    mockTenant('owner', active())
    const user = userEvent.setup()
    renderBilling()
    const card = await overview()
    await user.click(await within(card).findByRole('button', { name: 'Update card' }))
    await waitFor(() => expect(opened).toHaveLength(1))
    act(() => {
      opened[0]?.handler({
        razorpay_payment_id: 'pay_1',
        razorpay_subscription_id: 'sub_1',
        razorpay_signature: 'signature',
      })
    })
    expect(
      await within(card).findByText('Card received. We’re confirming it with Razorpay.')
    ).toBeInTheDocument()

    expect(within(card).getByRole('button', { name: 'Switch to yearly' })).toBeEnabled()
    expect(within(card).getByRole('button', { name: 'Update card' })).toBeEnabled()

    // The owner then cancels in another tab, and the view arrives over the stream.
    act(() => {
      queryClient.setQueryData(['tenants', 'acme', 'billing'], active({ cancelAtPeriodEnd: true }))
    })

    expect(
      await within(card).findByRole('button', { name: 'Keep Paid after 2 November 2099' })
    ).toBeEnabled()
  })

  it('drops a card change’s waiting line when the owner confirms a cancel', async () => {
    server.use(
      http.post(`${BASE}/billing/payment-method`, () =>
        ok(
          {
            purpose: 'card_change',
            keyId: 'rzp_test_key',
            subscriptionId: 'sub_1',
            amountMinor: 99_900,
            currency: 'INR',
            interval: 'month',
            startsAt: null,
            prefill: { name: 'Ada Lovelace', email: testUser.email },
          },
          'Card change started.',
          201
        )
      ),
      http.post(`${BASE}/billing/checkout/confirm`, () => fail('Internal server error.', 500)),
      // The cancel is refused, so the view stays as it was: only the confirm drops the line.
      http.post(`${BASE}/billing/cancel`, () => fail('Internal server error.', 500))
    )
    mockTenant('owner', active())
    const user = userEvent.setup()
    renderBilling()
    const card = await overview()
    await user.click(await within(card).findByRole('button', { name: 'Update card' }))
    await waitFor(() => expect(opened).toHaveLength(1))
    act(() => {
      opened[0]?.handler({
        razorpay_payment_id: 'pay_1',
        razorpay_subscription_id: 'sub_1',
        razorpay_signature: 'signature',
      })
    })
    const line = 'Card received. We’re confirming it with Razorpay.'
    expect(await within(card).findByText(line)).toBeInTheDocument()

    await user.click(within(card).getByRole('button', { name: 'Cancel Paid' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel Paid?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel Paid' }))

    await waitFor(() => expect(within(card).queryByText(line)).toBeNull())
  })

  it('says GST is included only when the business is registered', async () => {
    mockTenant('owner')
    renderBilling()
    const card = await overview()
    await within(card).findByRole('button', { name: 'Upgrade to Paid' })
    expect(within(card).queryByText('Includes 18% GST')).toBeNull()

    queryClient.setQueryData(['plans'], { ...testPlans, gstRegistered: true })
    expect(await within(card).findByText('Includes 18% GST')).toBeInTheDocument()
  })

  it('offers the switch, a new card and cancel on an active subscription', async () => {
    mockTenant('owner', active())
    renderBilling()
    const card = await overview()
    expect(
      await within(card).findByRole('button', { name: 'Switch to yearly' })
    ).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Update card' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Cancel Paid' })).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Upgrade to Paid' })).toBeNull()
  })

  it('offers Paid again after the period while cancelling, and no cancel', async () => {
    mockTenant('owner', active({ cancelAtPeriodEnd: true }))
    renderBilling()
    const card = await overview()
    expect(
      await within(card).findByRole('button', { name: 'Keep Paid after 2 November 2099' })
    ).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Cancel Paid' })).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Update card' })).toBeNull()
    expect(within(card).queryByRole('button', { name: /^Switch to/ })).toBeNull()
  })

  it('names a scheduled switch and keeps cancel, with no plan choice', async () => {
    mockTenant(
      'owner',
      active({ cancelAtPeriodEnd: true, nextSwitch: { interval: 'year', startsAt: PERIOD_END } })
    )
    renderBilling()
    const card = await overview()
    expect(
      await within(card).findByText('Switches to yearly on 2 November 2099.')
    ).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Cancel Paid' })).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /^Switch to/ })).toBeNull()
    expect(
      within(card).queryByRole('button', { name: /Keep Paid after|Upgrade to Paid/ })
    ).toBeNull()
  })

  it('says when the switch opens before the first charge', async () => {
    mockTenant('owner', active({ trialEndsAt: TRIAL_END, currentPeriodEnd: TRIAL_END }))
    renderBilling()
    const card = await overview()
    expect(
      await within(card).findByText('You can switch after your first charge on 5 November 2099.')
    ).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /^Switch to/ })).toBeNull()
  })

  it('offers a new card and cancel, but no switch, when a payment failed', async () => {
    mockTenant(
      'owner',
      active({ state: 'past_due', pastDue: { since: SINCE, graceEndsAt: null, paused: false } })
    )
    renderBilling()
    const card = await overview()
    expect(await within(card).findByRole('button', { name: 'Update card' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Cancel Paid' })).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /^Switch to/ })).toBeNull()
  })

  it('shows the server’s message when the switch is refused', async () => {
    server.use(
      http.post(`${BASE}/billing/interval`, () =>
        fail(
          'You can switch after your renewal on 2 November 2099.',
          409,
          SWITCH_TOO_CLOSE_TO_RENEWAL
        )
      )
    )
    mockTenant('owner', active())
    const user = userEvent.setup()
    renderBilling()
    const card = await overview()
    await user.click(await within(card).findByRole('button', { name: 'Switch to yearly' }))
    expect(
      await within(card).findByText('You can switch after your renewal on 2 November 2099.')
    ).toBeInTheDocument()
  })

  it('replaces every owner write with one line while payments are off, and asks for no invoices', async () => {
    const invoices = countGets(`${BASE}/billing/invoices`, () => ok(listPage([])))
    mockTenant('owner', active({ paymentsEnabled: false }))
    renderBilling()
    const card = await overview()
    expect(await within(card).findByText('Payments aren’t set up yet.')).toBeInTheDocument()
    for (const name of ['Switch to yearly', 'Update card', 'Cancel Paid', 'Upgrade to Paid']) {
      expect(within(card).queryByRole('button', { name })).toBeNull()
    }
    expect(screen.queryByRole('heading', { name: 'Invoices' })).toBeNull()
    expect(invoices.count).toBe(0)
  })

  it('replaces Upgrade with the same line in the trial while payments are off', async () => {
    mockTenant('owner', testBilling({ trialEndsAt: TRIAL_END, paymentsEnabled: false }))
    renderBilling()
    const card = await overview()
    expect(await within(card).findByText('Payments aren’t set up yet.')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Upgrade to Paid' })).toBeNull()
  })
})

describe('billing page, one checkout', () => {
  /** The overview's state line, once its dates have loaded: the banner waits on the same settings read. */
  async function stateLineReads(line: string) {
    const card = await overview()
    await waitFor(() =>
      expect(card.querySelector('[data-slot="billing-state"]')?.textContent).toBe(line)
    )
  }

  it.each([
    [
      'a payment failed',
      active({
        state: 'past_due',
        pastDue: { since: SINCE, graceEndsAt: '2026-10-27T09:00:00.000Z', paused: false },
      }),
      'Paid · Payment failed on 20 October 2026',
      'Your card payment of ₹999 failed on 20 October 2026. Update your card by 27 October 2026 to keep Paid.',
    ],
    [
      'payments are paused',
      active({
        state: 'past_due',
        pastDue: { since: SINCE, graceEndsAt: '2026-10-27T09:00:00.000Z', paused: true },
      }),
      'Paid · Payments paused on 20 October 2026',
      'Payments are paused in your UPI app. Resume them there by 27 October 2026 to keep Paid.',
    ],
    [
      'the payer left',
      active({ payer: { userId: 'user-left', name: 'Grace Hopper', isMember: false } }),
      'Paid · ₹999 per month · Renews 2 November 2099',
      'Billing uses Grace Hopper’s card, and they left the workspace. Add your card by 2 November 2099 to keep Paid.',
    ],
  ])(
    'keeps the banner’s sentence but offers one card button when %s',
    async (_case, billing, line, sentence) => {
      mockTenant('owner', billing)
      renderBilling()
      await stateLineReads(line)
      // The payer-left sentence nests the masked name in a span of its own, so both spans match.
      const banner = await screen.findAllByText(
        (_content, element) => element?.textContent === sentence && element.tagName === 'SPAN'
      )
      expect(banner.length).toBeGreaterThan(0)
      expect(screen.getAllByRole('button', { name: /^(Update card|Use my card)$/ })).toHaveLength(1)
    }
  )

  it('keeps the trial-ending sentence but no banner Upgrade link above the plan choice', async () => {
    const endsIn2Days = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
    mockTenant('owner', testBilling({ trialEndsAt: endsIn2Days }))
    renderBilling()
    const card = await overview()
    expect(await within(card).findByRole('button', { name: 'Upgrade to Paid' })).toBeInTheDocument()
    expect(await screen.findByText(/^Your Paid trial ends on /)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^Upgrade$/ })).toBeNull()
  })
})

describe('billing page, cancel', () => {
  it('toasts the end date though the cancel’s follow-up reads are still loading', async () => {
    server.use(
      http.post(`${BASE}/billing/cancel`, () =>
        ok(active({ cancelAtPeriodEnd: true }), 'Cancelled.')
      )
    )
    mockTenant('owner', active())
    const user = userEvent.setup()
    renderBilling()
    const card = await overview()
    await user.click(await within(card).findByRole('button', { name: 'Cancel Paid' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel Paid?' })

    // The refetches the cancel starts hang until released, as on a slow network: the dialog unmounts first.
    /** Lets the held request answer; replaced below. */
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.get(`${BASE}/entitlements`, async () => {
        await held
        return ok(testEntitlements(), 'Entitlements retrieved.')
      })
    )
    await user.click(within(dialog).getByRole('button', { name: 'Cancel Paid' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Paid ends on 2 November 2099.'))
    release()
  })

  it('confirms in one step, cancels, and toasts the end date', async () => {
    let cancels = 0
    server.use(
      http.post(`${BASE}/billing/cancel`, () => {
        cancels += 1
        return ok(active({ cancelAtPeriodEnd: true }), 'Cancelled.')
      })
    )
    mockTenant('owner', active())
    const user = userEvent.setup()
    renderBilling()
    const card = await overview()
    await user.click(await within(card).findByRole('button', { name: 'Cancel Paid' }))

    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel Paid?' })
    expect(dialog).toHaveTextContent(
      'You keep Paid until 2 November 2099. Then the workspace moves to Free. Nothing is deleted.'
    )
    expect(track).toHaveBeenCalledWith('cancel_started')
    expect(within(dialog).getByRole('button', { name: 'Keep Paid' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel Paid' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Paid ends on 2 November 2099.'))
    expect(cancels).toBe(1)
    expect(track).toHaveBeenCalledWith('cancel_confirmed')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('says the trial resumes before the first charge, and toasts it', async () => {
    server.use(
      http.post(`${BASE}/billing/cancel`, () =>
        ok(testBilling({ trialEndsAt: TRIAL_END }), 'Cancelled.')
      )
    )
    mockTenant('owner', active({ trialEndsAt: TRIAL_END, currentPeriodEnd: TRIAL_END }))
    const user = userEvent.setup()
    renderBilling()
    const card = await overview()
    await user.click(await within(card).findByRole('button', { name: 'Cancel Paid' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel Paid?' })
    expect(dialog).toHaveTextContent(
      'You won’t be charged. Your trial runs until 5 November 2099, then the workspace moves to Free.'
    )
    await user.click(within(dialog).getByRole('button', { name: 'Cancel Paid' }))
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'Paid cancelled. Your trial runs until 5 November 2099.'
      )
    )
  })

  it('says Paid ends now when a payment failed, and toasts Free', async () => {
    server.use(
      http.post(`${BASE}/billing/cancel`, () =>
        ok(
          testBilling({ state: 'free', plan: { key: 'free', name: 'Free' }, trialEndsAt: null }),
          'Cancelled.'
        )
      )
    )
    mockTenant(
      'owner',
      active({ state: 'past_due', pastDue: { since: SINCE, graceEndsAt: null, paused: false } })
    )
    const user = userEvent.setup()
    renderBilling()
    const card = await overview()
    await user.click(await within(card).findByRole('button', { name: 'Cancel Paid' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel Paid?' })
    expect(dialog).toHaveTextContent(
      'Paid ends now and the workspace moves to Free. Nothing is deleted.'
    )
    await user.click(within(dialog).getByRole('button', { name: 'Cancel Paid' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('You’re on Free.'))
  })

  it('toasts the server’s message when the cancel is refused', async () => {
    server.use(
      http.post(`${BASE}/billing/cancel`, () =>
        fail('Your subscription already ends on 2 November 2099.', 409, 'NO_SUBSCRIPTION')
      )
    )
    mockTenant('owner', active())
    const user = userEvent.setup()
    renderBilling()
    const card = await overview()
    await user.click(await within(card).findByRole('button', { name: 'Cancel Paid' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel Paid?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel Paid' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Your subscription already ends on 2 November 2099.')
    )
  })
})

describe('billing page, who sees what', () => {
  it('tells an editor only owners can change billing, with no owner action and no owner reads', async () => {
    const invoices = countGets(`${BASE}/billing/invoices`, () => ok(listPage([])))
    const requests = countGets(`${BASE}/upgrade-requests`, () => ok([]))
    mockTenant('editor', active())
    renderBilling()
    const card = await overview()
    expect(await screen.findByText('Only owners can change billing.')).toBeInTheDocument()
    await within(card).findByText('Paid · ₹999 per month · Renews 2 November 2099')
    expect(within(card).queryAllByRole('button')).toEqual([])
    expect(invoices.count).toBe(0)
    expect(requests.count).toBe(0)
  })

  it('lets an editor on Free ask the owners to upgrade', async () => {
    mockTenant(
      'editor',
      testBilling({ state: 'free', plan: { key: 'free', name: 'Free' }, trialEndsAt: null })
    )
    renderBilling()
    await overview()
    expect(await screen.findByRole('button', { name: 'Request upgrade' })).toBeInTheDocument()
    expect(track).toHaveBeenCalledWith('upgrade_prompt_viewed', { surface: 'billing_page' })
  })

  it('shows staff the overview only: no buttons, no owner line, no owner reads', async () => {
    const invoices = countGets(`${BASE}/billing/invoices`, () => ok(listPage([])))
    const requests = countGets(`${BASE}/upgrade-requests`, () => ok([]))
    mockTenant('owner', active(), 'platform')
    renderBilling()
    const card = await overview()
    await within(card).findByText('Paid · ₹999 per month · Renews 2 November 2099')
    expect(within(card).queryAllByRole('button')).toEqual([])
    expect(screen.queryByText('Only owners can change billing.')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Invoices' })).toBeNull()
    expect(invoices.count).toBe(0)
    expect(requests.count).toBe(0)
  })

  it.each([
    ['trialing', testBilling({ trialEndsAt: TRIAL_END }), 'Paid trial · Ends 5 November 2099'],
    [
      'past due',
      active({ state: 'past_due', pastDue: { since: SINCE, graceEndsAt: null, paused: false } }),
      'Paid · Payment failed on 20 October 2026',
    ],
    [
      'free',
      testBilling({ state: 'free', plan: { key: 'free', name: 'Free' }, trialEndsAt: null }),
      undefined,
    ],
  ])('shows staff a %s workspace with no owner action', async (_case, billing, line) => {
    const invoices = countGets(`${BASE}/billing/invoices`, () => ok(listPage([])))
    const requests = countGets(`${BASE}/upgrade-requests`, () => ok([]))
    mockTenant('owner', billing, 'platform')
    renderBilling()
    const card = await overview()
    await waitFor(() =>
      expect(card.querySelector('[data-slot="billing-state"]')?.textContent).toBe(line)
    )
    expect(within(card).queryAllByRole('button')).toEqual([])
    expect(within(card).queryAllByRole('link')).toEqual([])
    expect(screen.queryByText('Payments aren’t set up yet.')).toBeNull()
    expect(screen.queryByText('Only owners can change billing.')).toBeNull()
    expect(invoices.count).toBe(0)
    expect(requests.count).toBe(0)
  })
})

describe('billing page, invoices', () => {
  it('lists date, amount and status, with View only where Razorpay gave a link', async () => {
    server.use(
      http.get(`${BASE}/billing/invoices`, () =>
        ok(
          listPage([
            invoice(),
            invoice({
              id: 'inv_2',
              status: 'issued',
              paidAt: null,
              url: null,
              issuedAt: '2026-09-02T18:30:00.000Z',
            }),
          ]),
          'Invoices retrieved.'
        )
      )
    )
    mockTenant('owner', active())
    renderBilling()
    const table = await screen.findByRole('table', { name: 'Invoices' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((row) => row.textContent)).toEqual([
      '2 October 2026₹999PaidView',
      '2 September 2026₹999Not paid',
    ])
    const view = within(rows[0] as HTMLElement).getByRole('link', {
      name: 'View invoice of 2 October 2026',
    })
    expect(view).toHaveAttribute('href', 'https://rzp.io/i/abc')
    expect(view).toHaveAttribute('target', '_blank')
    expect(view).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it.each([
    ['cancelled', 'Cancelled'],
    ['expired', 'Expired'],
  ] as const)('labels a %s invoice', async (status, label) => {
    server.use(
      http.get(`${BASE}/billing/invoices`, () =>
        ok(listPage([invoice({ status })]), 'Invoices retrieved.')
      )
    )
    mockTenant('owner', active())
    renderBilling()
    const table = await screen.findByRole('table', { name: 'Invoices' })
    expect(within(table).getByText(label)).toBeInTheDocument()
  })

  it('says when there are none', async () => {
    mockTenant('owner', active())
    renderBilling()
    expect(await screen.findByText('No invoices yet.')).toBeInTheDocument()
  })

  it('shows more on request, from the next cursor', async () => {
    const cursors: (string | null)[] = []
    server.use(
      http.get(`${BASE}/billing/invoices`, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        cursors.push(cursor)
        return cursor === null
          ? ok(
              listPage([invoice()], { hasNext: true, nextCursor: 'next-1' }),
              'Invoices retrieved.'
            )
          : ok(
              listPage([invoice({ id: 'inv_2', issuedAt: '2026-09-02T18:30:00.000Z' })]),
              'Invoices retrieved.'
            )
      })
    )
    mockTenant('owner', active())
    const user = userEvent.setup()
    renderBilling()
    await user.click(await screen.findByRole('button', { name: 'Show more' }))
    expect(await screen.findByText('2 September 2026')).toBeInTheDocument()
    expect(screen.getByText('2 October 2026')).toBeInTheDocument()
    expect(cursors).toEqual([null, 'next-1'])
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  it('starts over from the first page after a billing change, never resending an old cursor', async () => {
    const cursors: (string | null)[] = []
    let scope = 1
    server.use(
      http.get(`${BASE}/billing/invoices`, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        cursors.push(cursor)
        // Express binds a cursor to the subscriptions it pages; a change makes the old one invalid.
        if (cursor !== null && cursor !== `next-${String(scope)}`) {
          return fail(
            'This page link is out of date. Go back to the first page.',
            400,
            'CURSOR_INVALID'
          )
        }
        return cursor === null
          ? ok(
              listPage([invoice()], { hasNext: true, nextCursor: `next-${String(scope)}` }),
              'Invoices retrieved.'
            )
          : ok(
              listPage([invoice({ id: 'inv_2', issuedAt: '2026-09-02T18:30:00.000Z' })]),
              'Invoices retrieved.'
            )
      }),
      http.post(`${BASE}/billing/cancel`, () => {
        scope = 2
        return ok(active({ cancelAtPeriodEnd: true }), 'Cancelled.')
      })
    )
    mockTenant('owner', active())
    const user = userEvent.setup()
    renderBilling()
    await user.click(await screen.findByRole('button', { name: 'Show more' }))
    expect(await screen.findByText('2 September 2026')).toBeInTheDocument()
    expect(cursors).toEqual([null, 'next-1'])

    await user.click(screen.getByRole('button', { name: 'Cancel Paid' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel Paid?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel Paid' }))

    await waitFor(() => expect(cursors).toEqual([null, 'next-1', null]))
    await waitFor(() => expect(screen.queryByText('2 September 2026')).toBeNull())
    expect(screen.getByText('2 October 2026')).toBeInTheDocument()
    expect(screen.queryByText('Invoices didn’t load. Try again.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Show more' })).toBeEnabled()
  })
})

describe('billing page, upgrade requests', () => {
  it('lists who asked, masked, with a fallback for an empty name', async () => {
    server.use(
      http.get(`${BASE}/upgrade-requests`, () =>
        ok(
          [
            testUpgradeRequest(),
            testUpgradeRequest({
              id: 'upgrade-request-2',
              requestedBy: { userId: 'u-3', name: '' },
            }),
          ],
          'Upgrade requests retrieved.'
        )
      )
    )
    mockTenant('owner')
    renderBilling()
    const heading = await screen.findByRole('heading', { level: 2, name: 'Upgrade requests' })
    const card = heading.closest('[data-slot="card"]') as HTMLElement
    const items = within(card).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual([
      'Grace Hopper asked to upgrade on 20 October 2026.',
      'A member asked to upgrade on 20 October 2026.',
    ])
    expect(within(card).getByText('Grace Hopper')).toHaveClass(PII_CLASS_NAME)
  })

  it('shows no card when no one asked', async () => {
    mockTenant('owner')
    renderBilling()
    await overview()
    await screen.findByText('No invoices yet.')
    expect(screen.queryByRole('heading', { name: 'Upgrade requests' })).toBeNull()
  })
})
