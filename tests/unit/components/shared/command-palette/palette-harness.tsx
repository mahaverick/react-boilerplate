/**
 * @file A small app around `CommandPaletteShell`, for the shared palette
 * tests: two pages, a dialog-backed action, a copy, a command that keeps the
 * palette open, a disabled row, and two API searches
 * (`/api/v1/palette-test/tenants` and `/users`) shaped like the apps' own.
 * The `/tenants/$tenantId` page registers a This page command while mounted.
 * No query retries, so a failure shows at once.
 */
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useRouter,
  type AnyRouter,
} from '@tanstack/react-router'
import { render } from '@testing-library/react'
import { http } from 'msw'
import { useState } from 'react'
import { CommandPaletteShell } from '@/components/shared/command-palette/command-palette-shell'
import { copyId } from '@/components/shared/command-palette/copy-id'
import { usePaletteCommands } from '@/components/shared/command-palette/palette-registry'
import type { PaletteCommand, RecentEntry } from '@/components/shared/command-palette/palette-types'
import { remoteGroup } from '@/components/shared/command-palette/remote-group'
import { usePaletteShortcut } from '@/components/shared/command-palette/use-palette-shortcut'
import { usePaletteTerm } from '@/components/shared/command-palette/use-palette-term'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { analyticsKey } from '@/observability/telemetry'
import { listQueryOptions } from '@/queries/list.queries'
import { listPage } from '@/tests/fixtures/list-page'
import { ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

/** A tenant row the test search answers. */
export interface TestTenant {
  id: string
  name: string
  slug: string
}

/** A user row the test search answers. */
export interface TestUser {
  id: string
  email: string
  name: string
}

/** The tenant the searches find for "acme". */
export const ACME: TestTenant = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Acme Corp',
  slug: 'acme',
}

/** The user the searches find for "cleo". */
export const CLEO: TestUser = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'cleo@example.com',
  name: 'Cleo Doe',
}

/** The test pages; each renders its own path as its heading. */
const PAGES = ['/overview', '/tenants', '/tenants/$tenantId', '/users/$userId'] as const

/** Answers both searches with no rows; a test's own `server.use` wins. */
export function serveEmptySearches(): void {
  server.use(
    http.get('/api/v1/palette-test/tenants', () => ok(listPage([]))),
    http.get('/api/v1/palette-test/users', () => ok(listPage([])))
  )
}

/** One search's query, as an app's palette builds it. */
function useTestSearch<T>(name: 'tenants' | 'users', term: string, enabled: boolean) {
  return useQuery({
    ...listQueryOptions<T>({
      key: ['palette-test', name],
      path: `/palette-test/${name}`,
      request: { search: term, limit: 8 },
      total: false,
    }),
    placeholderData: undefined,
    retry: false,
    enabled,
  })
}

/** The test app's palette. `canSearch` false stands in for a caller with no search access. */
function TestPalette({ canSearch }: { canSearch: boolean }) {
  usePaletteShortcut()
  const router = useRouter()
  /** Opens a test route; the app's route types do not know the test router's paths. */
  const go = (href: string) => router.history.push(href)
  const [dialogOpen, setDialogOpen] = useState(false)
  const { current, term, ready } = usePaletteTerm()
  const tenants = useTestSearch<TestTenant>('tenants', term, canSearch && ready)
  const users = useTestSearch<TestUser>('users', term, canSearch && ready)

  /** A Go to row. */
  const page = (label: string, to: '/overview' | '/tenants'): PaletteCommand => ({
    id: to,
    label,
    action: analyticsKey('open_page'),
    timing: 'immediate',
    run: () => go(to),
  })

  /** A recent entry as a row: a user's is personal. */
  const recentToCommand = (entry: RecentEntry): PaletteCommand => ({
    id: entry.id,
    label: entry.label,
    detail: entry.detail,
    pii: entry.kind === 'user',
    action: analyticsKey('open_recent'),
    timing: 'immediate',
    run: () => go(entry.kind === 'tenant' ? `/tenants/${entry.id}` : `/users/${entry.id}`),
  })

  return (
    <>
      <CommandPaletteShell
        groups={[
          {
            id: 'navigate',
            commands: [page('Overview', '/overview'), page('Tenants', '/tenants')],
          },
          {
            id: 'tenants',
            label: 'Switch tenant',
            commands: [
              {
                id: ACME.id,
                label: 'Switch to Acme',
                action: analyticsKey('switch_tenant'),
                timing: 'immediate',
                run: () => go('/tenants'),
              },
            ],
          },
          {
            id: 'account',
            commands: [
              {
                id: 'open-dialog',
                label: 'Open the test dialog',
                action: analyticsKey('create_tenant'),
                timing: 'afterClose',
                run: () => setDialogOpen(true),
              },
              {
                id: 'copy',
                label: 'Copy test ID',
                action: analyticsKey('copy_id'),
                timing: 'immediate',
                run: () => copyId('test-id-1', 'Test ID copied.'),
              },
              {
                id: 'stay',
                label: 'Stay open',
                action: analyticsKey('retry_search'),
                timing: 'stay',
                run: () => {},
              },
              {
                id: 'blocked',
                label: 'Blocked thing',
                detail: 'Suspended',
                disabled: true,
                action: analyticsKey('switch_tenant'),
                timing: 'immediate',
                run: () => go('/tenants'),
              },
            ],
          },
        ]}
        remote={[
          remoteGroup({
            id: 'tenants',
            enabled: canSearch,
            current,
            term,
            query: tenants,
            toCommands: (data) =>
              data.items.map((row) => ({
                id: row.id,
                label: row.name,
                detail: row.slug,
                action: analyticsKey('open_tenant'),
                timing: 'immediate',
                run: () => go(`/tenants/${row.id}`),
              })),
          }),
          remoteGroup({
            id: 'users',
            enabled: canSearch,
            current,
            term,
            query: users,
            toCommands: (data) =>
              data.items.map((row) => ({
                id: row.id,
                label: row.email,
                detail: row.name,
                pii: true,
                action: analyticsKey('open_user'),
                timing: 'immediate',
                run: () => go(`/users/${row.id}`),
              })),
          }),
        ]}
        recentToCommand={recentToCommand}
        inputLabel="Search the test app"
        placeholder="Search the test app…"
        description="Search the test app’s pages, tenants and users."
      />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogTitle>Test dialog</DialogTitle>
          <input aria-label="Reason" />
        </DialogContent>
      </Dialog>
    </>
  )
}

/** A test page; the tenant page registers Suspend under This page while mounted. */
function TestPage({ path }: { path: string }) {
  usePaletteCommands(
    'test-source',
    path === '/tenants/$tenantId'
      ? [
          {
            id: 'suspend',
            label: 'Suspend',
            action: analyticsKey('page_action_suspend'),
            timing: 'immediate',
            run: () => {},
          },
        ]
      : []
  )
  return <h1>{path}</h1>
}

/**
 * Mounts the test palette beside a stub route for each test page.
 * @param options - `canSearch` (default true) and the starting `path`
 *   (default `/overview`).
 * @returns The router.
 */
export function renderPalette({
  canSearch = true,
  path = '/overview',
}: { canSearch?: boolean; path?: string } = {}): AnyRouter {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <TestPalette canSearch={canSearch} />
        <Outlet />
      </>
    ),
  })
  const pages = PAGES.map((route) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path: route,
      component: () => <TestPage path={route} />,
    })
  )
  const router = createRouter({
    routeTree: rootRoute.addChildren(pages),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return router
}
