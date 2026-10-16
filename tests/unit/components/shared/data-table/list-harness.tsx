/**
 * @file A one-route app around `DataTable`, for the shared list tests: a
 * test list (`/items`) with two sortable columns, a comma-list filter, a yes/no
 * filter and a row action, served by MSW at `/api/v1/test/items`. Its query
 * never retries, so a failure shows at once.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { createColumnHelper } from '@tanstack/react-table'
import { render } from '@testing-library/react'
import { http } from 'msw'
import { afterEach } from 'vitest'
import { DataTable, type DataTableProps } from '@/components/shared/data-table/data-table'
import type {
  DataTableFeatures,
  DataTableFilter,
} from '@/components/shared/data-table/data-table-model'
import { useListQuery } from '@/components/shared/data-table/use-list-query'
import { useListSearch } from '@/components/shared/data-table/use-list-search'
import { analyticsKey } from '@/observability/telemetry'
import { listQueryOptions } from '@/queries/list.queries'
import { booleanFilter, defineList, listFilter } from '@/schemas/list.schemas'
import { fail, ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { ListPage, ListRequest } from '@/types/list.types'

afterEach(() => {
  window.innerWidth = DESKTOP_WIDTH
})

/** The viewport width every test starts at, above the 768 px breakpoint. */
const DESKTOP_WIDTH = 1024

/** Narrows the viewport to a phone (below 768 px) until the test ends; the harness restores it. */
export function atPhoneWidth(): void {
  window.innerWidth = 390
}

/** One row of the test list. */
export interface TestItem {
  id: string
  name: string
  status: 'active' | 'inactive'
  createdAt: string
}

/** The test list's URL contract: name first, then created either way. */
const testList = defineList({
  sorts: ['name', 'created', '-created'],
  filters: { status: listFilter(['active', 'inactive']), verified: booleanFilter() },
  table: analyticsKey('test_items'),
})

/**
 * One page of the test list.
 * @param request - From the list's state.
 */
function testListOptions(request: ListRequest) {
  return listQueryOptions<TestItem>({
    key: ['test-items'],
    path: '/test/items',
    request,
    retry: () => false,
  })
}

const column = createColumnHelper<DataTableFeatures, TestItem>()

/** Name (sortable), Status, Created (sortable both ways) and an Open action. */
export const testColumns = column.columns([
  column.accessor('name', {
    header: 'Name',
    meta: { sorts: ['name'], sortName: analyticsKey('name') },
  }),
  column.accessor('status', { header: 'Status' }),
  column.accessor('createdAt', {
    header: 'Created',
    meta: { sorts: ['created', '-created'], sortName: analyticsKey('created'), sortWords: 'date' },
  }),
  column.display({
    id: 'actions',
    header: () => <span className="sr-only">Actions</span>,
    meta: { label: 'Actions', actions: true },
    cell: ({ row }) => <button type="button">Open {row.original.name}</button>,
  }),
])

/** The Status facet (any number of values) and the Verified facet (one at a time). */
export const testFilters: readonly DataTableFilter[] = [
  {
    name: 'status',
    label: 'Status',
    options: [
      { value: 'active', label: 'Active' },
      { value: 'inactive', label: 'Inactive' },
    ],
  },
  {
    name: 'verified',
    label: 'Verified',
    options: [
      { value: 'true', label: 'Verified' },
      { value: 'false', label: 'Unverified' },
    ],
    single: true,
  },
]

/**
 * Test row `index`: "Item NN", active unless `status` says otherwise.
 * @param index - The row's number.
 * @param status - Its status.
 */
export function testItem(index: number, status: TestItem['status'] = 'active'): TestItem {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    name: `Item ${String(index).padStart(2, '0')}`,
    status,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

/** A failure the test API answers: a status, and the `code` a refusal carries. */
export interface TestRefusal {
  status: number
  code?: string
}

/** The API's answer to a cursor it will not page from: a 400 with `code: 'CURSOR_INVALID'`. */
export const REFUSED_CURSOR: TestRefusal = { status: 400, code: 'CURSOR_INVALID' }

/**
 * Answers `GET /api/v1/test/items` with `respond`, recording each request's
 * params. A number answers that status as a failure with no code; a
 * `TestRefusal` answers its status and code.
 * @param respond - The page for a request's params, or a failure.
 * @returns Every request's params, in order.
 */
export function serveTestItems(
  respond: (
    params: URLSearchParams
  ) => ListPage<TestItem> | number | TestRefusal | Promise<ListPage<TestItem>>
): URLSearchParams[] {
  const seen: URLSearchParams[] = []
  server.use(
    http.get('/api/v1/test/items', async ({ request }) => {
      const params = new URL(request.url).searchParams
      seen.push(params)
      const answer = await respond(params)
      if (typeof answer === 'number') return fail('Refused.', answer)
      if ('items' in answer) return ok(answer, 'Items retrieved.')
      return fail('Validation failed', answer.status, answer.code)
    })
  )
  return seen
}

/**
 * Mounts `/items` with `DataTable` over the test list, at `path`.
 * @param path - The URL to start at, search included.
 * @param props - Props to pass the table beside the defaults.
 * @param queryClient - The client to mount under, when the test needs to refetch through it.
 * @returns The router, to read its location.
 */
export function renderTestList(
  path = '/items',
  props: Partial<DataTableProps<TestItem>> = {},
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
): AnyRouter {
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  /** The list page. */
  function ItemsPage() {
    const list = useListSearch(testList)
    const query = useListQuery(list, testListOptions)
    return (
      <DataTable
        columns={testColumns}
        query={query}
        label="Items"
        getRowId={(row) => row.id}
        empty={<p>No items yet.</p>}
        search={{ label: 'Search items' }}
        filters={testFilters}
        {...props}
      />
    )
  }
  const itemsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/items',
    validateSearch: testList.schema,
    component: ItemsPage,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([itemsRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return router
}
