import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { useCurrentTenantStore } from '@/states/current-tenant.store'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/** The acme row as `GET /api/v1/tenants` lists it. */
const ACME_ROW = {
  tenant: {
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
    isPlatform: false,
  },
  role: 'owner',
  isPlatform: false,
}

/** Mounts the real route tree at `path`. */
function renderAt(path: string): AnyRouter {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return router as AnyRouter
}

describe('settings landing page', () => {
  beforeEach(() => {
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
  })

  it('lists every account page as a link', async () => {
    renderAt('/settings')
    const account = await screen.findByRole('region', { name: 'Account' })
    for (const name of ['Profile', 'Security', 'Notifications']) {
      expect(
        within(account).getByRole('link', { name: new RegExp(`^${name}`) })
      ).toBeInTheDocument()
    }
  })

  it('links workspace pages to the remembered tenant', async () => {
    server.use(http.get('/api/v1/tenants', () => ok([ACME_ROW], 'Tenants.')))
    useCurrentTenantStore.getState().remember(testUser.id, 'acme')
    renderAt('/settings')
    const workspace = await screen.findByRole('region', { name: 'Workspace' })
    await waitFor(() =>
      expect(within(workspace).getByRole('link', { name: /^Members/ })).toHaveAttribute(
        'href',
        '/settings/workspace/acme/members'
      )
    )
  })

  it('asks to choose a tenant when there is none, without links', async () => {
    renderAt('/settings')
    const workspace = await screen.findByRole('region', { name: 'Workspace' })
    expect(within(workspace).getByText('Choose a tenant first.')).toBeInTheDocument()
    expect(within(workspace).queryByRole('link')).toBeNull()
  })
})
