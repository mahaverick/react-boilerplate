import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRoute,
} from '@tanstack/react-router'
import { act, render, screen, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { CaptureResult } from 'posthog-js'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { resetSessionForTests } from '@/http/session'
import { buildPosthogOptions } from '@/observability/telemetry/posthog-options'
import { tenantKeys, type TenantDetail } from '@/queries/tenant.queries'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { usePasskeySetupStore } from '@/states/passkey-setup.store'
import { TENANT_ID, TENANT_ID_2 } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { fail, ok, tenantDetail, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/** A router over the real route tree and the memory history at `path`. */
function buildRouter(path: string) {
  return createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
    ...ROUTER_DEFAULTS,
  })
}

/** Mounts the real route tree at `path` and returns the router. */
function renderAppAt(path: string) {
  const router = buildRouter(path)
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return router
}

/** Whether a route has child routes; a route tree stores them as an object or an array. */
function hasChildren(route: AnyRoute): boolean {
  const children = route.children as unknown
  if (Array.isArray(children)) return children.length > 0
  return typeof children === 'object' && children !== null && Object.keys(children).length > 0
}

/** One tenant row, as `GET /tenants/:slug` returns it before `tenantDetail` adds the role. */
const ACME = {
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

/** Does nothing: the release a gate holds until its promise has started. */
function noop(): void {
  // Intentionally empty.
}

/** A gate a handler can wait on, and the call that opens it. */
function deferred() {
  let release: () => void = noop
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return { gate, release }
}

describe('page titles', () => {
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
  })

  it('names the profile page', async () => {
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    renderAppAt('/settings/account/profile')

    await screen.findByRole('heading', { name: 'Profile', level: 1 })
    await waitFor(() => {
      expect(document.title).toBe('Profile · React Boilerplate')
    })
  })

  it('replaces the title when the reader navigates to another page', async () => {
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    const router = renderAppAt('/dashboard')
    await screen.findByRole('heading', { name: /Welcome back/ })
    await waitFor(() => {
      expect(document.title).toBe('Dashboard · React Boilerplate')
    })

    await act(() => router.navigate({ to: '/settings/account/profile' }))

    await screen.findByRole('heading', { name: 'Profile', level: 1 })
    await waitFor(() => {
      expect(document.title).toBe('Profile · React Boilerplate')
    })
    // One title element, not a stale one beside the new one.
    expect(document.querySelectorAll('title')).toHaveLength(1)
  })

  it('names the sign-in page', async () => {
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
    server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
    renderAppAt('/login')

    await screen.findByRole('heading', { name: 'Sign in', level: 1 })
    await waitFor(() => {
      expect(document.title).toBe('Sign in · React Boilerplate')
    })
  })

  /** Signs the owner in and serves acme's detail, members and settings; `detail` replaces the detail answer. */
  function serveAcme(
    detail: () => Response | Promise<Response> = () =>
      ok(tenantDetail(ACME, 'owner'), 'Tenant retrieved.')
  ) {
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    server.use(
      http.get('/api/v1/tenants/acme', detail),
      http.get('/api/v1/tenants/acme/members', () => ok(listPage([]), 'Members retrieved.'))
    )
  }

  // The page's title, not its layouts' (`Settings · React Boilerplate`): the deepest match's head() wins when the router merges them.
  it('puts the workspace name, not its slug, in a workspace settings page title', async () => {
    serveAcme()
    renderAppAt('/settings/workspace/acme/members')

    await waitFor(() => {
      expect(document.title).toBe('Members · Acme Corp · React Boilerplate')
    })
    expect(document.querySelectorAll('title')).toHaveLength(1)
  })

  it('titles a workspace page with the page name alone until the workspace loads, never the slug', async () => {
    const { gate: held, release: answer } = deferred()
    serveAcme(async () => {
      await held
      return ok(tenantDetail(ACME, 'owner'), 'Tenant retrieved.')
    })
    renderAppAt('/settings/workspace/acme/members')

    await waitFor(() => {
      expect(document.title).toBe('Members · React Boilerplate')
    })
    answer()
    await waitFor(() => {
      expect(document.title).toBe('Members · Acme Corp · React Boilerplate')
    })
  })

  it('keeps the workspace name when the reader moves to another workspace page', async () => {
    serveAcme()
    const router = renderAppAt('/settings/workspace/acme/members')
    await waitFor(() => {
      expect(document.title).toBe('Members · Acme Corp · React Boilerplate')
    })

    await act(() =>
      router.navigate({ to: '/settings/workspace/$slug/activity', params: { slug: 'acme' } })
    )

    await waitFor(() => {
      expect(document.title).toBe('Activity · Acme Corp · React Boilerplate')
    })
    expect(document.querySelectorAll('title')).toHaveLength(1)
  })

  it('keeps the workspace name out of the title analytics sends', async () => {
    serveAcme()
    renderAppAt('/settings/workspace/acme/members')
    await waitFor(() => {
      expect(document.title).toBe('Members · Acme Corp · React Boilerplate')
    })

    const beforeSend = buildPosthogOptions({
      apiHost: 'https://app.example.com/api/v1/collect',
      uiHost: 'https://us.posthog.com',
      consentMode: 'opt_out',
      urlAllowlist: [],
      persistenceName: undefined,
      crossSubdomainCookie: true,
      onLoaded: noop,
    }).before_send as (event: CaptureResult | null) => CaptureResult | null
    const sent = beforeSend({
      uuid: 'u',
      event: '$pageview',
      properties: { title: document.title },
    })
    expect(sent?.properties.title).toBe('Members · React Boilerplate')
  })

  it('follows a rename of the workspace', async () => {
    serveAcme()
    renderAppAt('/settings/workspace/acme/members')
    await waitFor(() => {
      expect(document.title).toBe('Members · Acme Corp · React Boilerplate')
    })

    act(() => {
      queryClient.setQueryData(
        tenantKeys.detail('acme'),
        (tenant: TenantDetail | null | undefined) =>
          tenant ? { ...tenant, name: 'Acme Labs' } : tenant
      )
    })

    await waitFor(() => {
      expect(document.title).toBe('Members · Acme Labs · React Boilerplate')
    })
  })

  it('drops the previous workspace’s name while the next workspace loads', async () => {
    serveAcme()
    const { gate, release } = deferred()
    server.use(
      http.get('/api/v1/tenants/globex', async () => {
        await gate
        return ok(
          tenantDetail({ ...ACME, id: TENANT_ID_2, name: 'Globex Ltd', slug: 'globex' }, 'owner'),
          'Tenant retrieved.'
        )
      }),
      http.get('/api/v1/tenants/globex/members', () => ok(listPage([]), 'Members retrieved.'))
    )
    const router = renderAppAt('/settings/workspace/acme/members')
    await waitFor(() => {
      expect(document.title).toBe('Members · Acme Corp · React Boilerplate')
    })

    await act(() =>
      router.navigate({ to: '/settings/workspace/$slug/members', params: { slug: 'globex' } })
    )

    await waitFor(() => {
      expect(document.title).toBe('Members · React Boilerplate')
    })
    release()
    await waitFor(() => {
      expect(document.title).toBe('Members · Globex Ltd · React Boilerplate')
    })
  })

  it('drops the previous workspace’s name when the next workspace is not available', async () => {
    serveAcme()
    server.use(http.get('/api/v1/tenants/gone', () => fail('Tenant not found.', 404)))
    const router = renderAppAt('/settings/workspace/acme/members')
    await waitFor(() => {
      expect(document.title).toBe('Members · Acme Corp · React Boilerplate')
    })

    await act(() =>
      router.navigate({ to: '/settings/workspace/$slug/members', params: { slug: 'gone' } })
    )

    await screen.findByRole('heading', { name: 'Workspace not available' })
    expect(document.title).toBe('Members · React Boilerplate')
  })

  // Profile and Members have their own tests above.
  it.each([
    ['the settings landing page', '/settings', 'Settings'],
    ['the security settings page', '/settings/account/security', 'Security'],
    ['the delete account settings page', '/settings/account/delete', 'Delete account'],
    ['the notification settings page', '/settings/account/notifications', 'Notifications'],
    ['the workspace general page', '/settings/workspace/acme/general', 'General · Acme Corp'],
    ['the workspace activity page', '/settings/workspace/acme/activity', 'Activity · Acme Corp'],
    ['the workspace overview page', '/tenants/acme', 'Overview · Acme Corp'],
    ['the invitation confirmation page', '/invitations/confirm', 'Join your team'],
    ['the confirm-it’s-you page', '/auth/confirm', 'Confirm it’s you'],
  ])('names %s', async (_name, path, title) => {
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    server.use(
      http.get('/api/v1/tenants/acme', () => ok(tenantDetail(ACME, 'owner'), 'Tenant retrieved.')),
      http.get('/api/v1/tenants/acme/members', () => ok(listPage([]), 'Members retrieved.'))
    )
    renderAppAt(path)

    await waitFor(() => {
      expect(document.title).toBe(`${title} · React Boilerplate`)
    })
    expect(document.querySelectorAll('title')).toHaveLength(1)
  })

  it('gives every page a title: the root has a fallback and every leaf page its own', () => {
    const router = buildRouter('/')
    expect(router.routeTree.options.head).toBeTypeOf('function')

    const pages = (Object.values(router.routesById) as AnyRoute[]).filter(
      (route) => !route.isRoot && !hasChildren(route) && route.options.component !== undefined
    )
    // The filter must have found the pages, or the check below would pass on none.
    expect(pages.map((route) => String(route.id))).toContain('/_app/settings/account/profile')
    const untitled = pages
      .filter((route) => typeof route.options.head !== 'function')
      .map((route) => String(route.id))
    expect(untitled).toEqual([])
  })

  it('titles the passkey setup screen, and gives the page its title back afterwards', async () => {
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    usePasskeySetupStore.setState({ required: true, message: null })
    renderAppAt('/settings/account/profile')

    await waitFor(() => expect(document.title).toBe('Create your passkey · React Boilerplate'))
    expect(document.querySelectorAll('title')).toHaveLength(1)
    act(() => usePasskeySetupStore.getState().setRequired(false))
    await screen.findByRole('heading', { name: 'Profile', level: 1 })
    await waitFor(() => expect(document.title).toBe('Profile · React Boilerplate'))
  })

  it('titles an unknown URL as not found', async () => {
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
    server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
    renderAppAt('/definitely-not-a-page')
    await screen.findByText('Page not found')
    await waitFor(() => expect(document.title).toBe('Page not found · React Boilerplate'))
  })
})
