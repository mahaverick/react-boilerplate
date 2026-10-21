import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { useListQuery } from '@/components/shared/data-table/use-list-query'
import { useListSearch } from '@/components/shared/data-table/use-list-search'
import * as analytics from '@/observability/telemetry'
import { analyticsKey } from '@/observability/telemetry'
import { listQueryOptions } from '@/queries/list.queries'
import { dayFilter, defineList, listFilter } from '@/schemas/list.schemas'
import { listPage } from '@/tests/fixtures/list-page'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { ListRequest } from '@/types/list.types'

const invitations = defineList({
  sorts: ['-created', 'email'],
  filters: { role: listFilter(['owner', 'viewer']) },
  table: analyticsKey('test_invitations'),
  prefix: 'invitations',
})

const members = defineList({
  sorts: ['name', 'email'],
  filters: { role: listFilter(['owner', 'viewer']), from: dayFilter(), to: dayFilter() },
  table: analyticsKey('test_members'),
  also: [invitations],
})

/**
 * One page of the members probe list.
 * @param request - From the list's state.
 */
function membersOptions(request: ListRequest) {
  return listQueryOptions<{ id: string }>({
    key: ['probe'],
    path: '/test/members',
    request,
    retry: () => false,
  })
}

/** Every render's `query.isError`, reset by `renderProbe`. */
const errorRenders: boolean[] = []

/** What the query read as on each render that was restarting. */
const restartRenders: { isLoading: boolean; isFetching: boolean; failureReason: unknown }[] = []

/** Shows both lists' values and requests, with a button per write. */
function Probe() {
  const list = useListSearch(members)
  const other = useListSearch(invitations)
  const query = useListQuery(list, membersOptions)
  const page = query.page
  errorRenders.push(query.query.isError)
  if (query.isRestarting) {
    restartRenders.push({
      isLoading: query.query.isLoading,
      isFetching: query.query.isFetching,
      failureReason: query.query.failureReason,
    })
  }
  return (
    <div>
      <output aria-label="members request">{JSON.stringify(list.request)}</output>
      <output aria-label="invitations request">{JSON.stringify(other.request)}</output>
      <output aria-label="page index">{String(list.pageIndex)}</output>
      <output aria-label="total">{query.total ? String(query.total.count) : 'none'}</output>
      <output aria-label="failed">{String(query.query.isError)}</output>
      <output aria-label="has next">{String(page?.hasNext ?? false)}</output>
      <output aria-label="restarting">{String(query.isRestarting)}</output>
      <button type="button" onClick={() => page && list.prev(page)}>
        Prev
      </button>
      <button type="button" onClick={() => list.reset()}>
        Reset
      </button>
      <button type="button" onClick={() => list.setFilters({ role: ['viewer'] })}>
        Pick viewer
      </button>
      <button type="button" onClick={() => list.setFilters({ nope: ['x'] })}>
        Unknown filter
      </button>
      <button type="button" onClick={() => list.setSearch('grace')}>
        Search
      </button>
      <button type="button" onClick={() => list.setSearch(' \0 ')}>
        Blank search
      </button>
      <button type="button" onClick={() => list.setSearch(`  ${'a'.repeat(101)}`)}>
        Long search
      </button>
      <button type="button" onClick={() => list.setFilter('role', ['viewer'])}>
        Filter
      </button>
      <button
        type="button"
        onClick={() => list.setFilters({ from: ['2026-10-01'], to: ['2026-10-07'] })}
      >
        Dates
      </button>
      <button type="button" onClick={() => list.setSort('email', analyticsKey('email'))}>
        Sort
      </button>
      <button type="button" onClick={() => list.setSort('name', analyticsKey('name'))}>
        Default sort
      </button>
      <button type="button" onClick={() => list.setLimit(50)}>
        Limit
      </button>
      <button type="button" onClick={() => list.setHidden(['email'])}>
        Hide
      </button>
      <button type="button" onClick={() => page && list.next(page)}>
        Next
      </button>
      <button type="button" onClick={() => other.setSearch('ada')}>
        Search invitations
      </button>
    </div>
  )
}

/**
 * Mounts the probe at `path`.
 * @param path - The URL, search included.
 */
function renderProbe(path: string, gcTime?: number) {
  errorRenders.length = 0
  restartRenders.length = 0
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: '/members',
    validateSearch: members.schema,
    component: Probe,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime } } })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return router
}

/**
 * Serves the probe list: page one with a next cursor and a total, and page
 * two behind `c2`; a `bad` cursor is refused as the API refuses one (a 400
 * with `code: 'CURSOR_INVALID'`), and a `wrong` cursor with a 400 about
 * another field.
 * @returns Every request's params.
 */
function serveMembers(): URLSearchParams[] {
  const seen: URLSearchParams[] = []
  server.use(
    http.get('/api/v1/test/members', ({ request }) => {
      const params = new URL(request.url).searchParams
      seen.push(params)
      if (params.get('cursor') === 'bad') {
        return fail('Check the highlighted fields, then try again.', 400, 'CURSOR_INVALID')
      }
      if (params.get('cursor') === 'wrong')
        return fail('Check the highlighted fields, then try again.', 400)
      if (params.get('cursor') === 'c2')
        return ok(listPage([{ id: 'b' }], { hasPrev: true, prevCursor: 'c1' }))
      // A cursor whose page came back empty: 4a answers with the first page instead.
      if (params.get('cursor') === 'gone') {
        return ok(listPage([{ id: 'a' }], { nextCursor: 'c2-fresh', hasNext: true }))
      }
      return ok(
        listPage([{ id: 'a' }], { nextCursor: 'c2', hasNext: true }, { count: 2, capped: false })
      )
    })
  )
  return seen
}

afterEach(() => vi.restoreAllMocks())

describe('useListSearch', () => {
  it('drops the cursor on a search, a filter, a sort and a page size, and leaves defaults out', async () => {
    serveMembers()
    const user = userEvent.setup()
    const router = renderProbe('/members?cursor=c2')
    await screen.findByRole('status', { name: 'page index' })

    await user.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ search: 'grace' }))
    await router.navigate({ to: '/members', search: { cursor: 'c2' } } as never)
    await user.click(screen.getByRole('button', { name: 'Filter' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ role: 'viewer' }))
    await router.navigate({ to: '/members', search: { cursor: 'c2' } } as never)
    await user.click(screen.getByRole('button', { name: 'Sort' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ sort: 'email' }))
    await user.click(screen.getByRole('button', { name: 'Default sort' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    await router.navigate({ to: '/members', search: { cursor: 'c2' } } as never)
    await user.click(screen.getByRole('button', { name: 'Limit' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ limit: 50 }))
  })

  it('writes no search for blank text and at most 100 characters for long text', async () => {
    serveMembers()
    const user = userEvent.setup()
    const router = renderProbe('/members?search=grace')
    await user.click(await screen.findByRole('button', { name: 'Blank search' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    await user.click(screen.getByRole('button', { name: 'Long search' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ search: 'a'.repeat(100) }))
    expect(screen.getByRole('status', { name: 'members request' })).toHaveTextContent(
      `{"search":"${'a'.repeat(100)}"}`
    )
  })

  it('sets two filters in one navigation', async () => {
    serveMembers()
    const user = userEvent.setup()
    const router = renderProbe('/members?cursor=c2')
    await user.click(await screen.findByRole('button', { name: 'Dates' }))
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ from: '2026-10-01', to: '2026-10-07' })
    )
    expect(router.history.length).toBe(2)
  })

  it('keeps the page when a column is hidden, since no row changes', async () => {
    serveMembers()
    const user = userEvent.setup()
    const router = renderProbe('/members?cursor=c2')
    await user.click(await screen.findByRole('button', { name: 'Hide' }))
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ cursor: 'c2', hidden: 'email' })
    )
  })

  it('replaces the entry for a search and pushes one for a filter, so Back undoes a filter', async () => {
    serveMembers()
    const user = userEvent.setup()
    const router = renderProbe('/members')
    const { history } = router
    await user.click(await screen.findByRole('button', { name: 'Search' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ search: 'grace' }))
    expect(history.length).toBe(1)
    await user.click(screen.getByRole('button', { name: 'Filter' }))
    await waitFor(() => expect(history.length).toBe(2))
    history.back()
    await waitFor(() => expect(router.state.location.search).toEqual({ search: 'grace' }))
  })

  it('keeps two lists on one route apart', async () => {
    serveMembers()
    const user = userEvent.setup()
    const router = renderProbe('/members?search=grace')
    await user.click(await screen.findByRole('button', { name: 'Search invitations' }))
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ search: 'grace', invitationsSearch: 'ada' })
    )
    expect(screen.getByRole('status', { name: 'members request' })).toHaveTextContent(
      '{"search":"grace"}'
    )
    expect(screen.getByRole('status', { name: 'invitations request' })).toHaveTextContent(
      '{"search":"ada"}'
    )
  })

  it('counts pages this tab moved through, and reports the move', async () => {
    const track = vi.spyOn(analytics, 'track')
    serveMembers()
    const user = userEvent.setup()
    const router = renderProbe('/members')
    expect(await screen.findByRole('status', { name: 'page index' })).toHaveTextContent('0')
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'total' })).toHaveTextContent('2')
    )
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ cursor: 'c2' }))
    expect(screen.getByRole('status', { name: 'page index' })).toHaveTextContent('1')
    expect(track).toHaveBeenCalledWith('table_paged', {
      table: 'test_members',
      direction: 'next',
    })
  })

  it('reports a sort and a filter with fixed values only', async () => {
    const track = vi.spyOn(analytics, 'track')
    serveMembers()
    const user = userEvent.setup()
    renderProbe('/members')
    await user.click(await screen.findByRole('button', { name: 'Sort' }))
    await user.click(screen.getByRole('button', { name: 'Default sort' }))
    await user.click(screen.getByRole('button', { name: 'Filter' }))
    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(track).toHaveBeenCalledWith('table_sorted', {
      table: 'test_members',
      sort: 'email',
      direction: 'asc',
    })
    expect(track).toHaveBeenCalledWith('table_sorted', {
      table: 'test_members',
      sort: 'name',
      direction: 'default',
    })
    expect(track.mock.calls.filter(([event]) => event === 'table_filtered')).toHaveLength(2)
    expect(JSON.stringify(track.mock.calls)).not.toMatch(/grace|viewer/)
  })

  it('does not know the page of a cursor this tab never handed out', async () => {
    serveMembers()
    renderProbe('/members?cursor=elsewhere')
    expect(await screen.findByRole('status', { name: 'page index' })).toHaveTextContent('undefined')
  })

  it('counts on from the first page when the API answered a cursor with it', async () => {
    serveMembers()
    const user = userEvent.setup()
    const router = renderProbe('/members?cursor=gone')
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'has next' })).toHaveTextContent('true')
    )
    expect(screen.getByRole('status', { name: 'page index' })).toHaveTextContent('undefined')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ cursor: 'c2-fresh' }))
    expect(screen.getByRole('status', { name: 'page index' })).toHaveTextContent('1')
  })
})

describe('useListQuery', () => {
  it('keeps the first page’s total on a later page, which does not ask for one', async () => {
    const seen = serveMembers()
    const user = userEvent.setup()
    renderProbe('/members')
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'total' })).toHaveTextContent('2')
    )
    expect(seen.at(-1)?.get('total')).toBe('1')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(seen.at(-1)?.get('cursor')).toBe('c2'))
    expect(seen.at(-1)?.get('total')).toBeNull()
    expect(screen.getByRole('status', { name: 'total' })).toHaveTextContent('2')
  })

  it('keeps the first page’s total on a later page even when idle entries are collected at once', async () => {
    serveMembers()
    const user = userEvent.setup()
    const router = renderProbe('/members', 0)
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'total' })).toHaveTextContent('2')
    )
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ cursor: 'c2' }))
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'has next' })).toHaveTextContent('false')
    )
    expect(screen.getByRole('status', { name: 'total' })).toHaveTextContent('2')
  })

  it('shows no total for a new view until its own lands, and drops the old one', async () => {
    const seen = serveMembers()
    const user = userEvent.setup()
    renderProbe('/members')
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'total' })).toHaveTextContent('2')
    )
    seen.length = 0
    server.use(
      http.get('/api/v1/test/members', async ({ request }) => {
        const params = new URL(request.url).searchParams
        seen.push(params)
        await delay(100)
        return ok(listPage([{ id: 'z' }], {}, { count: 7, capped: false }))
      })
    )
    await user.click(screen.getByRole('button', { name: 'Filter' }))
    await waitFor(() => expect(seen).toHaveLength(1))
    expect(screen.getByRole('status', { name: 'total' })).toHaveTextContent('none')
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'total' })).toHaveTextContent('7')
    )
  })

  it('goes back to the first page, replacing the entry, when the API refuses the cursor', async () => {
    const seen = serveMembers()
    const router = renderProbe('/members?cursor=bad&sort=email')
    await waitFor(() => expect(router.state.location.search).toEqual({ sort: 'email' }))
    await waitFor(() => expect(seen.at(-1)?.get('cursor')).toBeNull())
    expect(router.history.length).toBe(1)
  })

  it('restarts once and never renders the refused cursor as an error', async () => {
    const seen = serveMembers()
    const router = renderProbe('/members?cursor=bad&direction=prev')
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'total' })).toHaveTextContent('2')
    )
    expect(screen.getByRole('status', { name: 'restarting' })).toHaveTextContent('false')
    expect(errorRenders).not.toContain(true)
    expect(restartRenders.length).toBeGreaterThan(0)
    expect(restartRenders.every((render) => render.failureReason === null)).toBe(true)
    expect(restartRenders.every((render) => render.isLoading === render.isFetching)).toBe(true)
    await settle(50, 'a looping restart would send more requests within a tick of the first page')
    expect(seen.map((params) => params.get('cursor'))).toEqual(['bad', null])
    expect(seen[1]?.get('direction')).toBeNull()
  })

  it('drops the direction on a search, a filter, a sort and a page size', async () => {
    serveMembers()
    const user = userEvent.setup()
    const router = renderProbe('/members?cursor=c2&direction=prev')
    const start = { to: '/members', search: { cursor: 'c2', direction: 'prev' } } as never
    await user.click(await screen.findByRole('button', { name: 'Search' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ search: 'grace' }))
    for (const [name, expected] of [
      ['Filter', { role: 'viewer' }],
      ['Sort', { sort: 'email' }],
      ['Limit', { limit: 50 }],
    ] as const) {
      await router.navigate(start)
      await user.click(screen.getByRole('button', { name }))
      await waitFor(() => expect(router.state.location.search).toEqual(expected))
    }
  })

  it('pages back, counting down, and reports it', async () => {
    const track = vi.spyOn(analytics, 'track')
    serveMembers()
    const user = userEvent.setup()
    const router = renderProbe('/members')
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'has next' })).toHaveTextContent('true')
    )
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'page index' })).toHaveTextContent('1')
    )
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'total' })).toHaveTextContent('2')
    )
    await user.click(screen.getByRole('button', { name: 'Prev' }))
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ cursor: 'c1', direction: 'prev' })
    )
    expect(screen.getByRole('status', { name: 'page index' })).toHaveTextContent('0')
    expect(track).toHaveBeenCalledWith('table_paged', { table: 'test_members', direction: 'prev' })
  })

  it('clears the search and every filter in one entry, and does nothing when none is set', async () => {
    const track = vi.spyOn(analytics, 'track')
    serveMembers()
    const user = userEvent.setup()
    const router = renderProbe('/members?cursor=c2')
    await user.click(await screen.findByRole('button', { name: 'Reset' }))
    expect(track).not.toHaveBeenCalled()
    expect(router.history.length).toBe(1)
    await router.navigate({
      to: '/members',
      search: { search: 'grace', role: 'viewer', cursor: 'c2', invitationsSearch: 'ada' },
    } as never)
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ invitationsSearch: 'ada' }))
    expect(track.mock.calls.filter(([event]) => event === 'table_filtered')).toHaveLength(1)
  })

  it('does nothing when a filter is set to what it already is, or to an unknown one', async () => {
    const track = vi.spyOn(analytics, 'track')
    serveMembers()
    const user = userEvent.setup()
    const router = renderProbe('/members?role=viewer&cursor=c2')
    await user.click(await screen.findByRole('button', { name: 'Pick viewer' }))
    await user.click(screen.getByRole('button', { name: 'Unknown filter' }))
    expect(track).not.toHaveBeenCalled()
    expect(router.history.length).toBe(1)
    expect(router.state.location.search).toEqual({ role: 'viewer', cursor: 'c2' })
  })

  it('leaves a sibling list’s cursor alone when this list is written', async () => {
    serveMembers()
    const user = userEvent.setup()
    const router = renderProbe('/members?cursor=c2&invitationsCursor=i2')
    await user.click(await screen.findByRole('button', { name: 'Search' }))
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ search: 'grace', invitationsCursor: 'i2' })
    )
  })

  it('shows the error, and keeps the cursor, when a 400 is not a refused cursor', async () => {
    const seen = serveMembers()
    const router = renderProbe('/members?cursor=wrong')
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'failed' })).toHaveTextContent('true')
    )
    await settle(50, 'a restart, if one wrongly fired, navigates within a tick of the error')
    expect(router.state.location.search).toEqual({ cursor: 'wrong' })
    expect(seen).toHaveLength(1)
  })
})
