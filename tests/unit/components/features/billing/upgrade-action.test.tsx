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
import { UpgradeAction } from '@/components/features/billing/upgrade-action'
import type { MembershipRole } from '@/constants/roles'
import { toast } from '@/lib/toast'
import * as analytics from '@/observability/telemetry'
import { analyticsKey } from '@/observability/telemetry'
import { billingKeys } from '@/queries/billing.queries'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, tenantDetail } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { ALREADY_PAID, type TenantAccess } from '@/types/api.types'
import type { UpgradeSurface } from '@/types/billing.types'

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

const REQUESTS_URL = '/api/v1/tenants/acme/upgrade-requests'

/** Serves acme's detail with the caller as `role`, reached through `access`. */
function serveRole(role: MembershipRole, access: TenantAccess = 'member') {
  server.use(
    http.get('/api/v1/tenants/acme', () =>
      ok(tenantDetail(TENANT, role, access), 'Tenant retrieved.')
    )
  )
}

/** Records each upgrade-request body and answers with `answer`. */
function serveRequest(answer: () => Response) {
  const bodies: unknown[] = []
  server.use(
    http.post(REQUESTS_URL, async ({ request }) => {
      bodies.push(await request.json())
      return answer()
    })
  )
  return bodies
}

/** Mounts the action for acme on a router of its own; returns the query client it uses. */
function renderAction(surface: UpgradeSurface = 'limit', entitlementKey = 'members') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <UpgradeAction slug="acme" surface={surface} entitlementKey={entitlementKey} />
      ),
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

describe('UpgradeAction for an owner', () => {
  it('links “Upgrade” to the billing page and tracks the click', async () => {
    const track = vi.spyOn(analytics, 'track')
    serveRole('owner')
    const user = userEvent.setup()
    renderAction()

    const link = await screen.findByRole('link', { name: 'Upgrade' })
    expect(link).toHaveAttribute('href', '/settings/workspace/acme/billing')
    expect(screen.queryByRole('button', { name: 'Request upgrade' })).toBeNull()
    expect(track).toHaveBeenCalledWith('upgrade_prompt_viewed', {
      surface: 'limit',
      key: analyticsKey('members'),
    })

    await user.click(link)
    expect(track).toHaveBeenCalledWith('upgrade_clicked', {
      surface: 'limit',
      key: analyticsKey('members'),
    })
  })
})

describe('UpgradeAction for a member who is not an owner', () => {
  it('asks the owners, says so, and becomes “Requested”', async () => {
    const track = vi.spyOn(analytics, 'track')
    serveRole('editor')
    const bodies = serveRequest(() =>
      ok(
        { id: 'request-1', createdAt: '2026-10-25T09:00:00.000Z', alreadyRequested: false },
        'Upgrade requested.',
        201
      )
    )
    const user = userEvent.setup()
    renderAction()

    await user.click(await screen.findByRole('button', { name: 'Request upgrade' }))

    expect(await screen.findByText('Requested')).toHaveFocus()
    expect(bodies).toEqual([{ key: 'members', surface: 'limit' }])
    expect(toast.success).toHaveBeenCalledWith(
      'Request sent. Owners will see it in their notifications.'
    )
    expect(screen.queryByRole('button', { name: 'Request upgrade' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Upgrade' })).toBeNull()
    expect(track).toHaveBeenCalledWith('upgrade_requested_ui', {
      surface: 'limit',
      key: analyticsKey('members'),
    })
  })

  it('says when the member already asked, dated in the tenant’s time zone', async () => {
    serveRole('admin')
    server.use(
      http.get('/api/v1/tenants/acme/settings', () =>
        ok(
          {
            tenantId: TENANT_ID,
            timezone: 'Asia/Kolkata',
            locale: 'en',
            metadata: null,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          'Settings retrieved.'
        )
      )
    )
    serveRequest(() =>
      ok(
        { id: 'request-1', createdAt: '2026-11-01T18:30:00.000Z', alreadyRequested: true },
        'Upgrade requested.'
      )
    )
    const user = userEvent.setup()
    renderAction()

    await user.click(await screen.findByRole('button', { name: 'Request upgrade' }))

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        'You already asked on 2 November 2026. Owners were told.'
      )
    })
    await screen.findByText('Requested')
  })

  it('dates the already-asked toast in UTC when the settings cannot be read', async () => {
    serveRole('viewer')
    server.use(
      http.get('/api/v1/tenants/acme/settings', () => fail('Tenant not found.', 404, 'NOT_FOUND'))
    )
    serveRequest(() =>
      ok(
        { id: 'request-1', createdAt: '2026-11-01T18:30:00.000Z', alreadyRequested: true },
        'Upgrade requested.'
      )
    )
    const user = userEvent.setup()
    renderAction()

    await user.click(await screen.findByRole('button', { name: 'Request upgrade' }))

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        'You already asked on 1 November 2026. Owners were told.'
      )
    })
  })

  it('shows the server’s message and refetches billing when the workspace is already on Paid', async () => {
    serveRole('editor')
    const message = 'This workspace is already on Paid. Refresh the page to see its features.'
    serveRequest(() => fail(message, 409, ALREADY_PAID))
    const user = userEvent.setup()
    const client = renderAction('feature', 'advanced_example')
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    await user.click(await screen.findByRole('button', { name: 'Request upgrade' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(message)
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: billingKeys.entitlements('acme') })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: billingKeys.billing('acme') })
    expect(screen.getByRole('button', { name: 'Request upgrade' })).toBeInTheDocument()
  })

  it('shows the server’s message when a stale role is refused', async () => {
    serveRole('editor')
    const message = 'Owners can upgrade from Billing.'
    serveRequest(() => fail(message, 403, 'FORBIDDEN'))
    const user = userEvent.setup()
    renderAction()

    await user.click(await screen.findByRole('button', { name: 'Request upgrade' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(message)
    })
  })

  it('posts the raw catalog key and the surface it sits on', async () => {
    serveRole('editor')
    const bodies = serveRequest(() =>
      ok(
        { id: 'request-1', createdAt: '2026-10-25T09:00:00.000Z', alreadyRequested: false },
        'Upgrade requested.',
        201
      )
    )
    const user = userEvent.setup()
    renderAction('feature', 'advanced_example')

    await user.click(await screen.findByRole('button', { name: 'Request upgrade' }))

    await screen.findByText('Requested')
    expect(bodies).toEqual([{ key: 'advanced_example', surface: 'feature' }])
  })
})

describe('UpgradeAction for staff through platform access', () => {
  it('renders nothing and tracks no prompt', async () => {
    const track = vi.spyOn(analytics, 'track')
    serveRole('owner', 'platform')
    const client = renderAction()

    await waitFor(() => {
      expect(client.getQueryState(['tenants', 'acme'])?.status).toBe('success')
    })
    await settle(50, 'the render after a cached result has no event to await')
    expect(screen.queryByRole('link', { name: 'Upgrade' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Request upgrade' })).toBeNull()
    expect(track).not.toHaveBeenCalledWith('upgrade_prompt_viewed', expect.anything())
  })
})
