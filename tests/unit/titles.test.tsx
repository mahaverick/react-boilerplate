import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRoute,
} from '@tanstack/react-router'
import { act, render, screen, waitFor } from '@testing-library/react'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { fail, ok, tenantDetail, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

function buildRouter(path: string) {
  return createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  })
}

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
    renderAppAt('/profile')

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

    await act(() => router.navigate({ to: '/profile' }))

    await screen.findByRole('heading', { name: 'Profile', level: 1 })
    await waitFor(() => {
      expect(document.title).toBe('Profile · React Boilerplate')
    })
    // One title element, not a stale one left beside the new one.
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

  // The tab's title, not its tenant layout's `acme · React Boilerplate`: the deepest match's head() wins when the router merges them.
  it('puts the tenant slug in a tenant tab title', async () => {
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    server.use(
      http.get('/api/v1/tenants/acme', () => ok(tenantDetail(ACME, 'owner'), 'Tenant retrieved.')),
      http.get('/api/v1/tenants/acme/members', () => ok([], 'Members retrieved.'))
    )
    renderAppAt('/tenants/acme/members')

    await waitFor(() => {
      expect(document.title).toBe('Members · acme · React Boilerplate')
    })
    expect(document.querySelectorAll('title')).toHaveLength(1)
  })

  it('gives every page a title: the root has a fallback and every leaf page its own', () => {
    const router = buildRouter('/')
    expect(router.routeTree.options.head).toBeTypeOf('function')

    const pages = (Object.values(router.routesById) as AnyRoute[]).filter(
      (route) => !route.isRoot && !hasChildren(route) && route.options.component !== undefined
    )
    // Not vacuous: the filter really found the pages.
    expect(pages.map((route) => String(route.id))).toContain('/_app/profile')
    const untitled = pages
      .filter((route) => typeof route.options.head !== 'function')
      .map((route) => String(route.id))
    expect(untitled).toEqual([])
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
