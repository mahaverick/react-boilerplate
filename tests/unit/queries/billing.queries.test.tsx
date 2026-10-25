import { QueryClient, QueryClientProvider, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { resetSessionForTests } from '@/http/session'
import {
  billingKeys,
  entitlementsQueryOptions,
  invalidateBilling,
  invoicesQueryOptions,
  plansQueryOptions,
  tenantBillingQueryOptions,
  upgradeRequestsQueryOptions,
  useCancelPaid,
  useConfirmCheckout,
  useDismissBanner,
  useEntitlements,
  useFeature,
  useLimit,
  usePlans,
  useRequestUpgrade,
  useStartCheckout,
  useSwitchInterval,
  useTenantBilling,
  useUpdateCard,
} from '@/queries/billing.queries'
import { INSIGHTS_LOCKED, insightsKey } from '@/queries/insights.queries'
import {
  tenantKeys,
  useInviteMember,
  useRemoveMember,
  useResendInvitation,
  useRevokeInvitation,
} from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'
import { testUpgradeRequest } from '@/tests/fixtures/billing'
import { INVITATION_ID, TENANT_ID, USER_ID_2 } from '@/tests/fixtures/ids'
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
import { PLAN_LIMIT_REACHED } from '@/types/api.types'
import type { CheckoutSession, InvoiceView } from '@/types/billing.types'

/** The `acme` tenant row `GET /tenants/acme` answers with. */
const TENANT_ROW = {
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

/** What the start, switch and card-change writes answer. */
const CHECKOUT_SESSION: CheckoutSession = {
  purpose: 'upgrade',
  keyId: 'rzp_test_key',
  subscriptionId: 'sub_1',
  amountMinor: 99_900,
  currency: 'INR',
  interval: 'month',
  startsAt: null,
  prefill: { name: 'A B', email: testUser.email },
}

/** One paid invoice row. */
const INVOICE: InvoiceView = {
  id: 'inv_1',
  amountMinor: 99_900,
  currency: 'INR',
  status: 'paid',
  issuedAt: '2026-10-01T00:00:00.000Z',
  paidAt: '2026-10-01T00:05:00.000Z',
  url: 'https://rzp.io/i/inv_1',
}

let client: QueryClient

/** Provides the per-test `client` to the hook under test. */
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/**
 * Counts `GET /tenants/acme/entitlements` calls, answering each with `testEntitlements()`.
 * @returns A reader for the count.
 */
function countEntitlementReads(): () => number {
  let calls = 0
  server.use(
    http.get('/api/v1/tenants/acme/entitlements', () => {
      calls += 1
      return ok(testEntitlements(), 'Entitlements retrieved.')
    })
  )
  return () => calls
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  resetSessionForTests()
  useAuthStore.setState({
    accessToken: 'access-token',
    user: testUser,
    isAuthenticated: true,
    isBootstrapped: true,
  })
})

describe('billing reads', () => {
  it('useLimit returns the members usage from entitlements', async () => {
    server.use(
      http.get('/api/v1/tenants/acme/entitlements', () =>
        ok(
          testEntitlements({
            plan: { key: 'free', name: 'Free' },
            state: 'free',
            trialEndsAt: null,
            limits: { members: { limit: 3, used: 3, approaching: false } },
          }),
          'Entitlements retrieved.'
        )
      )
    )
    const { result } = renderHook(() => useLimit('acme', 'members'), { wrapper })
    await waitFor(() => expect(result.current).toEqual({ limit: 3, used: 3, approaching: false }))
  })

  it('useLimit is undefined for a key the plan does not limit', async () => {
    const { result } = renderHook(
      () => ({ entitlements: useEntitlements('acme'), limit: useLimit('acme', 'projects') }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.entitlements.isSuccess).toBe(true))
    expect(result.current.limit).toBeUndefined()
  })

  it('useFeature is undefined while loading, then the plan answer, and false for an unknown key', async () => {
    const { result } = renderHook(
      () => ({
        insights: useFeature('acme', 'advanced_example'),
        unknown: useFeature('acme', 'nope'),
      }),
      { wrapper }
    )
    expect(result.current.insights).toEqual({ enabled: undefined })
    await waitFor(() => expect(result.current.insights).toEqual({ enabled: true }))
    expect(result.current.unknown).toEqual({ enabled: false })
  })

  it('usePlans reads the public plans under their own key', async () => {
    const { result } = renderHook(() => usePlans(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(testPlans))
    expect(plansQueryOptions().queryKey).toEqual(['plans'])
  })

  it('keeps every tenant billing key under the tenant prefix, so dropTenantCache covers it', () => {
    const prefix = tenantKeys.detail('acme')
    for (const key of [
      billingKeys.entitlements('acme'),
      billingKeys.billing('acme'),
      billingKeys.invoices('acme'),
      billingKeys.upgradeRequests('acme'),
      entitlementsQueryOptions('acme').queryKey,
      tenantBillingQueryOptions('acme').queryKey,
    ]) {
      expect(key.slice(0, 2)).toEqual(prefix)
    }
  })

  it('a 404 billing read (platform tenant or old API) resolves to null without retrying', async () => {
    client = new QueryClient({
      defaultOptions: { queries: { retry: (failureCount) => failureCount < 1 } },
    })
    let calls = 0
    server.use(
      http.get('/api/v1/tenants/acme/billing', () => {
        calls += 1
        return fail('Not found', 404)
      })
    )
    const { result } = renderHook(() => useQuery(tenantBillingQueryOptions('acme')), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
    expect(calls).toBe(1)
  })

  it('a billing read that fails otherwise rejects', async () => {
    server.use(http.get('/api/v1/tenants/acme/billing', () => fail('Server error', 500)))
    const { result } = renderHook(() => useQuery(tenantBillingQueryOptions('acme')), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('useTenantBilling reads billing for a customer tenant', async () => {
    server.use(
      http.get('/api/v1/tenants/acme', () =>
        ok(tenantDetail(TENANT_ROW, 'owner'), 'Tenant retrieved.')
      )
    )
    const { result } = renderHook(() => useTenantBilling('acme'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.state).toBe('trialing')
  })

  it('useTenantBilling is disabled for tenant.isPlatform', async () => {
    let billingCalls = 0
    server.use(
      http.get('/api/v1/tenants/acme', () =>
        ok({ ...tenantDetail(TENANT_ROW, 'owner'), isPlatform: true }, 'Tenant retrieved.')
      ),
      http.get('/api/v1/tenants/acme/billing', () => {
        billingCalls += 1
        return ok(testBilling(), 'Billing retrieved.')
      })
    )
    const { result } = renderHook(() => useTenantBilling('acme'), { wrapper })
    await waitFor(() => expect(client.getQueryData(tenantKeys.detail('acme'))).toBeDefined())
    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.data).toBeUndefined()
    expect(billingCalls).toBe(0)
  })

  it('reads invoices with the cursor, and asks nothing while disabled', async () => {
    const cursors: (string | null)[] = []
    const disabled = renderHook(
      () => useInfiniteQuery(invoicesQueryOptions('acme', { enabled: false })),
      { wrapper }
    )
    expect(disabled.result.current.fetchStatus).toBe('idle')
    disabled.unmount()

    server.use(
      http.get('/api/v1/tenants/acme/billing/invoices', ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        cursors.push(cursor)
        return ok(
          cursor === null ? listPage([INVOICE], { hasNext: true, nextCursor: 'c2' }) : listPage([]),
          'Invoices retrieved.'
        )
      })
    )
    const { result } = renderHook(() => useInfiniteQuery(invoicesQueryOptions('acme')), {
      wrapper,
    })
    await waitFor(() => expect(result.current.data?.pages[0]?.items).toEqual([INVOICE]))
    expect(result.current.hasNextPage).toBe(true)
    await act(() => result.current.fetchNextPage())
    await waitFor(() => expect(result.current.hasNextPage).toBe(false))
    expect(cursors).toEqual([null, 'c2'])
  })

  it('reads upgrade requests for an owner, and asks nothing while disabled', async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/tenants/acme/upgrade-requests', () => {
        calls += 1
        return ok([testUpgradeRequest()], 'Upgrade requests retrieved.')
      })
    )
    const disabled = renderHook(
      () => useQuery(upgradeRequestsQueryOptions('acme', { enabled: false })),
      { wrapper }
    )
    expect(disabled.result.current.fetchStatus).toBe('idle')
    expect(calls).toBe(0)

    const { result } = renderHook(() => useQuery(upgradeRequestsQueryOptions('acme')), { wrapper })
    await waitFor(() =>
      expect(result.current.data).toEqual([
        expect.objectContaining({ requestedBy: { userId: USER_ID_2, name: 'Grace Hopper' } }),
      ])
    )
  })
})

describe('invalidateBilling', () => {
  it('marks entitlements, billing, invoices, upgrade requests and insights stale', async () => {
    client.setQueryData(billingKeys.entitlements('acme'), testEntitlements())
    client.setQueryData(billingKeys.billing('acme'), testBilling())
    client.setQueryData(billingKeys.invoices('acme'), {
      pages: [listPage([INVOICE], { hasNext: true, nextCursor: 'c2' }), listPage([INVOICE])],
      pageParams: [null, 'c2'],
    })
    client.setQueryData(billingKeys.upgradeRequests('acme'), [])
    client.setQueryData(insightsKey('acme'), INSIGHTS_LOCKED)
    client.setQueryData(billingKeys.plans, testPlans)
    await invalidateBilling(client, 'acme')
    expect(client.getQueryState(billingKeys.entitlements('acme'))?.isInvalidated).toBe(true)
    expect(client.getQueryState(billingKeys.billing('acme'))?.isInvalidated).toBe(true)
    expect(client.getQueryState(billingKeys.invoices('acme'))?.isInvalidated).toBe(true)
    // A later page's cursor is bound to the subscriptions before the change, so only the first page stays.
    expect(client.getQueryData(billingKeys.invoices('acme'))).toEqual({
      pages: [listPage([INVOICE], { hasNext: true, nextCursor: 'c2' })],
      pageParams: [null],
    })
    expect(client.getQueryState(billingKeys.upgradeRequests('acme'))?.isInvalidated).toBe(true)
    // A 402 cached as locked would otherwise keep Insights locked after an upgrade.
    expect(client.getQueryState(insightsKey('acme'))?.isInvalidated).toBe(true)
    expect(client.getQueryState(billingKeys.plans)?.isInvalidated).toBe(false)
  })
})

describe('billing writes', () => {
  it('confirming checkout stores the billing answer and refetches entitlements', async () => {
    const entitlementCalls = countEntitlementReads()
    let billingCalls = 0
    const active = testBilling({
      state: 'active',
      interval: 'month',
      trialEndsAt: null,
      currentPeriodEnd: '2026-11-25T00:00:00.000Z',
    })
    let confirmBody: unknown
    server.use(
      http.get('/api/v1/tenants/acme/billing', () => {
        billingCalls += 1
        return ok(testBilling(), 'Billing retrieved.')
      }),
      http.post('/api/v1/tenants/acme/billing/checkout/confirm', async ({ request }) => {
        confirmBody = await request.json()
        return ok(active, 'Checkout confirmed.')
      })
    )
    const { result } = renderHook(
      () => ({
        entitlements: useEntitlements('acme'),
        billing: useQuery(tenantBillingQueryOptions('acme')),
        confirm: useConfirmCheckout('acme'),
      }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.entitlements.isSuccess).toBe(true))
    await waitFor(() => expect(result.current.billing.isSuccess).toBe(true))

    const payload = {
      razorpay_payment_id: 'pay_1',
      razorpay_subscription_id: 'sub_1',
      razorpay_signature: 'sig',
    }
    await act(() => result.current.confirm.mutateAsync(payload))

    expect(confirmBody).toEqual(payload)
    expect(client.getQueryData(billingKeys.billing('acme'))).toEqual(active)
    await waitFor(() => expect(entitlementCalls()).toBe(2))
    expect(billingCalls).toBe(1)
  })

  it('cancelling Paid stores the billing answer and refetches entitlements', async () => {
    const entitlementCalls = countEntitlementReads()
    const cancelling = testBilling({ state: 'active', cancelAtPeriodEnd: true })
    server.use(
      http.post('/api/v1/tenants/acme/billing/cancel', () => ok(cancelling, 'Paid cancelled.'))
    )
    const { result } = renderHook(
      () => ({ entitlements: useEntitlements('acme'), cancel: useCancelPaid('acme') }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.entitlements.isSuccess).toBe(true))
    await act(() => result.current.cancel.mutateAsync())
    expect(client.getQueryData(billingKeys.billing('acme'))).toEqual(cancelling)
    await waitFor(() => expect(entitlementCalls()).toBe(2))
  })

  it.each([
    ['start checkout', '/billing/checkout', useStartCheckout, { interval: 'year' }],
    ['switch interval', '/billing/interval', useSwitchInterval, { interval: 'month' }],
  ] as const)(
    '%s posts the interval and returns the checkout session',
    async (_name, path, useWrite, input) => {
      let body: unknown
      server.use(
        http.post(`/api/v1/tenants/acme${path}`, async ({ request }) => {
          body = await request.json()
          return ok(CHECKOUT_SESSION, 'Checkout started.')
        })
      )
      const { result } = renderHook(() => useWrite('acme'), { wrapper })
      const session = await act(() => result.current.mutateAsync(input))
      expect(body).toEqual(input)
      expect(session).toEqual(CHECKOUT_SESSION)
    }
  )

  it('updating the card posts an empty body and returns the checkout session', async () => {
    let body: unknown
    server.use(
      http.post('/api/v1/tenants/acme/billing/payment-method', async ({ request }) => {
        body = await request.json()
        return ok({ ...CHECKOUT_SESSION, purpose: 'card_change' }, 'Checkout started.')
      })
    )
    const { result } = renderHook(() => useUpdateCard('acme'), { wrapper })
    const session = await act(() => result.current.mutateAsync())
    expect(body).toEqual({})
    expect(session.purpose).toBe('card_change')
  })

  it('requesting an upgrade posts the key and surface and returns the request', async () => {
    let body: unknown
    const answer = { id: 'ur_1', createdAt: '2026-10-25T09:00:00.000Z', alreadyRequested: true }
    server.use(
      http.post('/api/v1/tenants/acme/upgrade-requests', async ({ request }) => {
        body = await request.json()
        return ok(answer, 'Upgrade requested.', 201)
      })
    )
    const { result } = renderHook(() => useRequestUpgrade('acme'), { wrapper })
    const request = await act(() =>
      result.current.mutateAsync({ key: 'members', surface: 'limit' })
    )
    expect(body).toEqual({ key: 'members', surface: 'limit' })
    expect(request).toEqual(answer)
  })

  it('dismissing a banner posts it and refetches billing', async () => {
    let body: unknown
    let billingCalls = 0
    server.use(
      http.get('/api/v1/tenants/acme/billing', () => {
        billingCalls += 1
        return ok(testBilling(), 'Billing retrieved.')
      }),
      http.post('/api/v1/tenants/acme/banner-dismissals', async ({ request }) => {
        body = await request.json()
        return ok(null, 'Banner dismissed.')
      })
    )
    const { result } = renderHook(
      () => ({
        billing: useQuery(tenantBillingQueryOptions('acme')),
        dismiss: useDismissBanner('acme'),
      }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.billing.isSuccess).toBe(true))
    await act(() => result.current.dismiss.mutateAsync('trial_ended'))
    expect(body).toEqual({ banner: 'trial_ended' })
    await waitFor(() => expect(billingCalls).toBe(2))
  })
})

describe('seat-changing writes refetch entitlements', () => {
  /** Mounts an entitlements observer beside `useWrite`, waits for the first read, and returns both. */
  async function mountWithEntitlements<T>(useWrite: () => T) {
    const entitlementCalls = countEntitlementReads()
    const view = renderHook(() => ({ entitlements: useEntitlements('acme'), write: useWrite() }), {
      wrapper,
    })
    await waitFor(() => expect(view.result.current.entitlements.isSuccess).toBe(true))
    expect(entitlementCalls()).toBe(1)
    return { view, entitlementCalls }
  }

  it('inviting a member refetches entitlements', async () => {
    const { view, entitlementCalls } = await mountWithEntitlements(() => useInviteMember('acme'))
    await act(() => view.result.current.write.mutateAsync({ email: 'new@b.com', role: 'editor' }))
    await waitFor(() => expect(entitlementCalls()).toBe(2))
  })

  it('an invite refused for the members limit refetches entitlements', async () => {
    server.use(
      http.post('/api/v1/tenants/acme/invitations', () =>
        fail('3 of 3 members on Free.', 402, PLAN_LIMIT_REACHED, {
          key: 'members',
          used: 3,
          limit: 3,
        })
      )
    )
    const { view, entitlementCalls } = await mountWithEntitlements(() => useInviteMember('acme'))
    await act(async () => {
      await view.result.current.write
        .mutateAsync({ email: 'new@b.com', role: 'editor' })
        .catch(() => undefined)
    })
    await waitFor(() => expect(entitlementCalls()).toBe(2))
  })

  it('resending an invitation refetches entitlements', async () => {
    const { view, entitlementCalls } = await mountWithEntitlements(() =>
      useResendInvitation('acme')
    )
    await act(() => view.result.current.write.mutateAsync(INVITATION_ID))
    await waitFor(() => expect(entitlementCalls()).toBe(2))
  })

  it('revoking an invitation refetches entitlements', async () => {
    const { view, entitlementCalls } = await mountWithEntitlements(() =>
      useRevokeInvitation('acme')
    )
    await act(() => view.result.current.write.mutateAsync(INVITATION_ID))
    await waitFor(() => expect(entitlementCalls()).toBe(2))
  })

  it('removing a member refetches entitlements', async () => {
    server.use(
      http.delete('/api/v1/tenants/acme/members/:userId', () => ok(null, 'Member removed.'))
    )
    const { view, entitlementCalls } = await mountWithEntitlements(() => useRemoveMember('acme'))
    await act(() => view.result.current.write.mutateAsync(USER_ID_2))
    await waitFor(() => expect(entitlementCalls()).toBe(2))
  })
})
