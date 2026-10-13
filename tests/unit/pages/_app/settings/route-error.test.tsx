import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsRouteError } from '@/components/features/route-error'
import { resetSessionForTests } from '@/http/session'
import { Route as AccountNotifications } from '@/pages/_app/settings/account.notifications'
import { Route as AccountProfile } from '@/pages/_app/settings/account.profile'
import { Route as AccountSecurity } from '@/pages/_app/settings/account.security'
import { Route as SettingsIndex } from '@/pages/_app/settings/index'
import { Route as WorkspaceActivity } from '@/pages/_app/settings/workspace.$slug.activity'
import { Route as WorkspaceGeneral } from '@/pages/_app/settings/workspace.$slug.general'
import { Route as WorkspaceMembers } from '@/pages/_app/settings/workspace.$slug.members'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { ok, tenantDetail, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

vi.mock('@/observability/errors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/observability/errors')>()),
  noteError: vi.fn(),
}))

/** Throws while rendering, standing in for a settings page that breaks. */
function Broken(): never {
  throw new Error('settings page exploded')
}

vi.mock('@/components/features/notifications/preferences-card', () => ({
  PreferencesCard: Broken,
}))
vi.mock('@/components/features/tenant/tenant-activity-panel', () => ({
  TenantActivityPanel: Broken,
}))

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

/** Mounts the real route tree at `path` with the app router's own error, not-found and pending screens. */
function renderAppAt(path: string) {
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
}

describe('a settings page that fails to render', () => {
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    // React logs the caught render error; the boundary catching it is what is under test.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['an account page', '/settings/account/notifications', 'Notifications'],
    ['a workspace page', '/settings/workspace/acme/activity', 'Activity'],
  ])(
    'keeps %s to one h1, the layout heading, with the error titled h2',
    async (_kind, path, h1) => {
      server.use(
        http.get('/api/v1/tenants/acme', () =>
          ok(tenantDetail(TENANT, 'owner', 'member'), 'Tenant retrieved.')
        )
      )
      renderAppAt(path)

      await screen.findByText('Something went wrong')
      const headings = screen.getAllByRole('heading', { level: 1 })
      expect(headings.map((heading) => heading.textContent)).toEqual([h1])
      expect(
        screen.getByRole('heading', { level: 2, name: 'Something went wrong' })
      ).toBeInTheDocument()
    }
  )

  it('gives every settings leaf the h2 error screen', () => {
    expect(SettingsRouteError).toBeTypeOf('function')
    for (const route of [
      SettingsIndex,
      AccountProfile,
      AccountSecurity,
      AccountNotifications,
      WorkspaceGeneral,
      WorkspaceMembers,
      WorkspaceActivity,
    ]) {
      expect(route.options.errorComponent, route.id).toBe(SettingsRouteError)
      // In the route's own module, not a lazy chunk: a chunk that failed to load could not fetch it.
      expect(route.options.codeSplitGroupings, route.id).toEqual([['component']])
    }
  })
})
