import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MembershipRole } from '@/constants/roles'
import { resetSessionForTests } from '@/http/session'
import * as analytics from '@/observability/analytics'
import { EXPOSURE_BATCH_MS, resetExposureForTests } from '@/observability/flags/exposure'
import { flagKeys } from '@/observability/flags/flag-query'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { settle } from '@/tests/fixtures/timing'
import { ok, tenantDetail, testFlags, testOnboarding, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { TenantAccess } from '@/types/api.types'

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

/** Every exposure POST body's keys, in arrival order. */
let exposures: string[][]

function mockTenant(variant: 'control' | 'bold', role: MembershipRole, access: TenantAccess) {
  server.use(
    http.get('/api/v1/tenants', () =>
      ok(access === 'member' ? [{ tenant: TENANT, role }] : [], 'Tenants retrieved.')
    ),
    http.get('/api/v1/tenants/acme', () =>
      ok(tenantDetail(TENANT, role, access), 'Tenant retrieved.')
    ),
    http.get('/api/v1/tenants/acme/onboarding', () =>
      ok(testOnboarding(), 'Onboarding retrieved.')
    ),
    http.get('/api/v1/tenants/acme/flags', () =>
      ok(testFlags({ example_cta_experiment: variant }), 'Flags retrieved.')
    ),
    http.post('/api/v1/tenants/acme/flags/exposures', async ({ request }) => {
      exposures.push(((await request.json()) as { keys: string[] }).keys)
      return new HttpResponse(null, { status: 204 })
    })
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
}

async function findCard(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: 'Getting started', level: 2 })
  const card = heading.closest('[data-slot="card"]')
  if (!(card instanceof HTMLElement)) throw new Error('the heading is not inside a card')
  return card
}

beforeEach(() => {
  resetSessionForTests()
  resetExposureForTests()
  window.sessionStorage.clear()
  queryClient.clear()
  exposures = []
  useAuthStore.setState({
    accessToken: 'access-token',
    user: testUser,
    isAuthenticated: true,
    isBootstrapped: true,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  resetExposureForTests()
})

describe('the getting-started CTA experiment', () => {
  it('shows control as an underlined link and reports one exposure', async () => {
    mockTenant('control', 'owner', 'member')
    renderOverview()
    const link = within(await findCard()).getByRole('link', { name: 'Open settings' })
    expect(link).toHaveClass('underline')
    expect(link).not.toHaveClass('bg-primary')
    await vi.waitFor(() => expect(exposures).toEqual([['example_cta_experiment']]))
  })

  it('shows bold as a filled button for every step link, reporting once', async () => {
    mockTenant('bold', 'owner', 'member')
    renderOverview()
    const card = await findCard()
    await waitFor(() =>
      expect(within(card).getByRole('link', { name: 'Open settings' })).toHaveClass('bg-primary')
    )
    expect(within(card).getByRole('link', { name: 'Open members' })).toHaveClass('bg-primary')
    await vi.waitFor(() => expect(exposures).toEqual([['example_cta_experiment']]))
    await settle(EXPOSURE_BATCH_MS * 4, 'absence has no event: a second batch would be due by now')
    expect(exposures).toHaveLength(1)
  })

  it('still sends feature_cta_clicked, the experiment metric, from the bold link', async () => {
    const track = vi.spyOn(analytics, 'track')
    mockTenant('bold', 'owner', 'member')
    renderOverview()
    const card = await findCard()
    const link = await within(card).findByRole('link', { name: 'Open settings' })
    await waitFor(() => expect(link).toHaveClass('bg-primary'))
    await userEvent.setup().click(link)
    expect(track).toHaveBeenCalledWith('feature_cta_clicked', { cta: 'onboarding_open_settings' })
  })

  it('reports nothing to staff, who see no link', async () => {
    mockTenant('bold', 'viewer', 'platform')
    renderOverview()
    const card = await findCard()
    expect(within(card).queryByRole('link', { name: 'Open settings' })).toBeNull()
    await waitFor(() =>
      expect(queryClient.getQueryState(flagKeys.tenant('acme'))?.status).toBe('success')
    )
    await settle(EXPOSURE_BATCH_MS * 4, 'absence has no event: a batch would be due by now')
    expect(exposures).toEqual([])
  })
})
