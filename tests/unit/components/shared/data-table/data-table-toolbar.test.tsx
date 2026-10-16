import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toggleValue, totalText } from '@/components/shared/data-table/data-table-model'
import * as analytics from '@/observability/telemetry'
import { listPage } from '@/tests/fixtures/list-page'
import { settle } from '@/tests/fixtures/timing'
import {
  atPhoneWidth,
  renderTestList,
  serveTestItems,
  testColumns,
  testFilters,
  testItem,
} from '@/tests/unit/components/shared/data-table/list-harness'

/** Two rows, a next page, and a total of 25. */
function onePage(params: URLSearchParams) {
  if (params.get('cursor')) return listPage([testItem(21)], { prevCursor: 'c1', hasPrev: true })
  return listPage(
    [testItem(1), testItem(2)],
    { nextCursor: 'c2', hasNext: true },
    {
      count: 25,
      capped: false,
    }
  )
}

/** The router history's pops, which `AnyRouter` types as `any`. */
interface RouterHistoryPops {
  back: () => void
  go: (n: number) => void
}

afterEach(() => vi.restoreAllMocks())

/**
 * Spies on `track` and returns how many `table_filtered` events it has seen.
 * @returns A reader of the count.
 */
function filteredCount(): () => number {
  const track = vi.spyOn(analytics, 'track')
  return () => track.mock.calls.filter(([event]) => event === 'table_filtered').length
}

describe('DataTable search', () => {
  it('debounces the box into ?search= and starts from the first page', async () => {
    const track = vi.spyOn(analytics, 'track')
    const seen = serveTestItems(onePage)
    const user = userEvent.setup()
    const router = renderTestList('/items?cursor=c2')
    await screen.findByText('Item 21')

    await user.type(screen.getByRole('searchbox', { name: 'Search items' }), 'acme')

    await waitFor(() => expect(router.state.location.search).toEqual({ search: 'acme' }))
    await waitFor(() => expect(seen.at(-1)?.get('search')).toBe('acme'))
    expect(seen.at(-1)?.get('cursor')).toBeNull()
    expect(track.mock.calls.filter(([event]) => event === 'table_filtered')).toEqual([
      ['table_filtered', { table: 'test_items' }],
    ])
  })

  it('drops ?search when the box is cleared', async () => {
    serveTestItems(onePage)
    const user = userEvent.setup()
    const router = renderTestList('/items?search=acme')
    const box = await screen.findByRole('searchbox', { name: 'Search items' })
    expect(box).toHaveValue('acme')
    await user.clear(box)
    await waitFor(() => expect(router.state.location.search).toEqual({}))
  })

  it('follows a search set from outside the box, as the palette or Back does', async () => {
    serveTestItems(onePage)
    const router = renderTestList('/items?search=acme')
    await screen.findByText('Item 01')
    await router.navigate({ to: '/items', search: { search: 'Beta' } } as never)
    await waitFor(() =>
      expect(screen.getByRole('searchbox', { name: 'Search items' })).toHaveValue('Beta')
    )
  })

  it('never lets a pending keystroke overwrite a search restored from outside', async () => {
    const track = vi.spyOn(analytics, 'track')
    const seen = serveTestItems(onePage)
    const user = userEvent.setup()
    const router = renderTestList('/items?search=acme')
    const box = await screen.findByRole('searchbox', { name: 'Search items' })
    await screen.findByText('Item 01')

    // A keystroke is waiting on its debounce when Back restores another term.
    await user.type(box, 'x')
    expect(box).toHaveValue('acmex')
    await router.navigate({ to: '/items', search: { search: 'Beta' } } as never)
    await waitFor(() => expect(box).toHaveValue('Beta'))

    await settle(500, 'the 250 ms debounce for "acmex" fires, or must not, and nothing shows it')
    expect(router.state.location.search).toEqual({ search: 'Beta' })
    expect(box).toHaveValue('Beta')
    expect(seen.map((params) => params.get('search'))).not.toContain('acmex')
    // The box wrote nothing at all: not the old text, not the pending one, not even a write that a later one would have undone.
    expect(track.mock.calls.filter(([event]) => event === 'table_filtered')).toEqual([])
  })

  it('keeps the newer keystrokes when its own write comes back', async () => {
    const user = userEvent.setup()
    serveTestItems(onePage)
    const router = renderTestList()
    const box = await screen.findByRole('searchbox', { name: 'Search items' })
    // Hold the box's first write back, so "c" is typed after it was made and before its echo renders.
    const realNavigate = router.navigate.bind(router)
    const held: Array<() => Promise<void>> = []
    router.navigate = ((options: Parameters<typeof realNavigate>[0]) => {
      if (held.length > 0) return realNavigate(options)
      held.push(() => realNavigate(options))
      return Promise.resolve()
    }) as typeof router.navigate
    await user.type(box, 'ab')
    await waitFor(() => expect(held).toHaveLength(1))
    await user.type(box, 'c')
    await held[0]!()
    await waitFor(() => expect(router.state.location.search).toEqual({ search: 'abc' }))
    expect(box).toHaveValue('abc')
  })

  it('keeps an outside search when two outside navigations land inside the debounce window', async () => {
    const count = filteredCount()
    serveTestItems(onePage)
    const router = renderTestList('/items?search=qq')
    const box = await screen.findByRole('searchbox', { name: 'Search items' })
    await screen.findByText('Item 01')

    await router.navigate({ to: '/items', search: { search: 'zz' } } as never)
    await waitFor(() => expect(box).toHaveValue('zz'))
    ;(router.history as { back: () => void }).back()
    await waitFor(() => expect(box).toHaveValue('qq'))

    await settle(
      500,
      'the 250 ms debounce for the old text fires, or must not, and nothing shows it'
    )
    expect(router.state.location.search).toEqual({ search: 'qq' })
    expect(box).toHaveValue('qq')
    expect(count()).toBe(0)
  })

  it('keeps a raw draft when an outside change lands on exactly its cleaned term', async () => {
    const count = filteredCount()
    serveTestItems(onePage)
    const router = renderTestList()
    const box = await screen.findByRole('searchbox', { name: 'Search items' })
    await screen.findByText('Item 01')

    fireEvent.change(box, { target: { value: 'acme ' } })
    await router.navigate({ to: '/items', search: { search: 'acme' } } as never)
    await settle(500, 'the pending write must not change the box or the URL, which nothing shows')

    expect(box).toHaveValue('acme ')
    expect(router.state.location.search).toEqual({ search: 'acme' })
    expect(count()).toBe(0)
  })

  it.each([
    ['Back', (history: RouterHistoryPops) => history.back()],
    ['go(-1)', (history: RouterHistoryPops) => history.go(-1)],
  ])('never lets a pending keystroke overwrite an entry %s restored', async (_name, pop) => {
    const count = filteredCount()
    serveTestItems(onePage)
    const user = userEvent.setup()
    const router = renderTestList('/items?search=ab')
    const box = await screen.findByRole('searchbox', { name: 'Search items' })
    await screen.findByText('Item 01')
    // A facet click pushes an entry with the same search term.
    await router.navigate({ to: '/items', search: { search: 'ab', status: 'active' } } as never)
    await screen.findByRole('button', { name: 'Remove filter: Status: Active' })

    await user.type(box, 'c')
    pop(router.history as RouterHistoryPops)
    await waitFor(() => expect(router.state.location.search).toEqual({ search: 'ab' }))
    await settle(500, 'the 250 ms debounce for "abc" fires, or must not, and nothing shows it')

    expect(router.state.location.search).toEqual({ search: 'ab' })
    expect(box).toHaveValue('ab')
    expect(count()).toBe(0)
  })

  it('writes a keystroke typed just before a facet click, with the facet applied', async () => {
    serveTestItems(onePage)
    const user = userEvent.setup()
    const router = renderTestList('/items?search=ab')
    const box = await screen.findByRole('searchbox', { name: 'Search items' })
    await screen.findByText('Item 01')

    await user.type(box, 'c')
    await user.click(screen.getByRole('button', { name: 'Filter by status, Items' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by status, Items' })
    await user.click(within(popup).getByRole('checkbox', { name: 'Active' }))

    await waitFor(() =>
      expect(router.state.location.search).toEqual({ search: 'abc', status: 'active' })
    )
    expect(box).toHaveValue('abc')
  })

  it('writes again after a blur ends a composition that never reported its end', async () => {
    serveTestItems(onePage)
    const router = renderTestList()
    const box = await screen.findByRole('searchbox', { name: 'Search items' })
    fireEvent.compositionStart(box)
    fireEvent.blur(box)
    fireEvent.change(box, { target: { value: 'ni' } })
    await waitFor(() => expect(router.state.location.search).toEqual({ search: 'ni' }))
  })

  it('writes nothing for a change that cleans to the same term', async () => {
    const count = filteredCount()
    const user = userEvent.setup()
    serveTestItems(onePage)
    renderTestList('/items?search=acme')
    const box = await screen.findByRole('searchbox', { name: 'Search items' })
    await user.type(box, ' ')
    await settle(500, 'a write that must not happen has no event to wait for')
    expect(count()).toBe(0)
  })

  it('holds back writes while an IME composition is active', async () => {
    const count = filteredCount()
    serveTestItems(onePage)
    const router = renderTestList()
    const box = await screen.findByRole('searchbox', { name: 'Search items' })
    fireEvent.compositionStart(box)
    fireEvent.change(box, { target: { value: 'ni' } })
    await settle(500, 'the debounce must not write during a composition, which nothing shows')
    expect(router.state.location.search).toEqual({})
    expect(count()).toBe(0)

    fireEvent.compositionEnd(box)
    await waitFor(() => expect(router.state.location.search).toEqual({ search: 'ni' }))
    expect(count()).toBe(1)
  })
})

describe('DataTable facets', () => {
  it('writes a comma list, drops the cursor, and counts the picks on the button', async () => {
    const count = filteredCount()
    const seen = serveTestItems(onePage)
    const user = userEvent.setup()
    const router = renderTestList('/items?cursor=c2')
    await screen.findByText('Item 21')

    await user.click(screen.getByRole('button', { name: 'Filter by status, Items' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by status, Items' })
    await user.click(within(popup).getByRole('checkbox', { name: 'Active' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ status: 'active' }))
    await user.click(within(popup).getByRole('checkbox', { name: 'Inactive' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ status: 'active,inactive' }))
    await waitFor(() => expect(seen.at(-1)?.get('status')).toBe('active,inactive'))
    expect(seen.at(-1)?.get('cursor')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Filter by status, Items, 2 selected' })
    ).toBeInTheDocument()
    expect(count()).toBe(2)
  })

  it('shows a chip per value, and a chip removes only its own value', async () => {
    const count = filteredCount()
    serveTestItems(onePage)
    const user = userEvent.setup()
    const router = renderTestList('/items?status=active,inactive')
    await screen.findByText('Item 01')

    await user.click(screen.getByRole('button', { name: 'Remove filter: Status: Active' }))

    await waitFor(() => expect(router.state.location.search).toEqual({ status: 'inactive' }))
    expect(
      screen.getByRole('button', { name: 'Remove filter: Status: Inactive' })
    ).toBeInTheDocument()
    expect(count()).toBe(1)
  })

  it('writes a yes/no filter as a boolean and keeps one pick at a time', async () => {
    serveTestItems(onePage)
    const user = userEvent.setup()
    const router = renderTestList()
    await screen.findByText('Item 01')
    await user.click(screen.getByRole('button', { name: 'Filter by verified, Items' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by verified, Items' })
    await user.click(within(popup).getByRole('checkbox', { name: 'Unverified' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ verified: false }))
    await user.click(within(popup).getByRole('checkbox', { name: 'Verified' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ verified: true }))
  })

  it('clears a facet with Clear filter, and focus stays in the popover', async () => {
    const count = filteredCount()
    serveTestItems(onePage)
    const user = userEvent.setup()
    const router = renderTestList('/items?status=active&sort=-created')
    await screen.findByText('Item 01')
    await user.click(screen.getByRole('button', { name: 'Filter by status, Items, 1 selected' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by status, Items' })
    await user.click(within(popup).getByRole('button', { name: 'Clear filter' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ sort: '-created' }))
    expect(count()).toBe(1)
    expect(within(popup).getByRole('checkbox', { name: 'Active' })).toHaveFocus()
  })

  it('clears the search and every filter with Reset, keeping the sort', async () => {
    const count = filteredCount()
    serveTestItems(onePage)
    const user = userEvent.setup()
    const router = renderTestList('/items?search=acme&status=active&sort=-created')
    await screen.findByText('Item 01')
    await user.click(screen.getByRole('button', { name: 'Reset, Items' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ sort: '-created' }))
    expect(screen.getByRole('searchbox', { name: 'Search items' })).toHaveValue('')
    expect(count()).toBe(1)
  })

  it('shows no chips or Reset on an unfiltered list', async () => {
    serveTestItems(onePage)
    renderTestList()
    await screen.findByText('Item 01')
    expect(screen.queryByRole('button', { name: 'Reset, Items' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Remove filter/ })).not.toBeInTheDocument()
  })

  it('says when a facet’s options fail, and retries them', async () => {
    serveTestItems(onePage)
    const retry = vi.fn()
    const user = userEvent.setup()
    renderTestList('/items', {
      filters: [
        {
          ...testFilters[0]!,
          options: [],
          optionsState: { isPending: false, isError: true, retry },
        },
      ],
    })
    await screen.findByText('Item 01')
    await user.click(screen.getByRole('button', { name: 'Filter by status, Items' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by status, Items' })
    expect(within(popup).getByText('Status could not be loaded.')).toBeInTheDocument()
    await user.click(within(popup).getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('says options are loading, and offers a search box that reports the term', async () => {
    serveTestItems(onePage)
    const onSearch = vi.fn()
    const user = userEvent.setup()
    renderTestList('/items', {
      filters: [
        {
          ...testFilters[0]!,
          options: [],
          optionsState: { isPending: true, isError: false, retry: vi.fn() },
          onSearch,
        },
      ],
    })
    await screen.findByText('Item 01')
    await user.click(screen.getByRole('button', { name: 'Filter by status, Items' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by status, Items' })
    expect(within(popup).getByText('Loading…')).toBeInTheDocument()
    await user.type(within(popup).getByRole('searchbox', { name: 'Search status' }), 'ab')
    expect(onSearch).toHaveBeenLastCalledWith('ab')
  })

  it('shows only a chip for a chip-only filter, and renders a custom chip', async () => {
    serveTestItems(onePage)
    renderTestList('/items?status=active&verified=true', {
      filters: [
        { ...testFilters[0]!, chipOnly: true },
        {
          ...testFilters[1]!,
          renderChip: (value, onRemove) => (
            <button type="button" onClick={onRemove}>
              Custom {value}
            </button>
          ),
        },
      ],
    })
    await screen.findByText('Item 01')
    expect(screen.queryByRole('button', { name: /^Filter by status/ })).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Remove filter: Status: Active' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Custom true' })).toBeInTheDocument()
  })

  it('computes the picks a checkbox leaves', () => {
    expect(toggleValue(['a'], 'b', true)).toEqual(['a', 'b'])
    expect(toggleValue(['a', 'b'], 'a', false)).toEqual(['b'])
    expect(toggleValue(['a'], 'b', true, true)).toEqual(['b'])
  })
})

describe('DataTable column menu', () => {
  it('writes ?hidden=, offers every column but the first, and leaves the default out', async () => {
    serveTestItems(onePage)
    const user = userEvent.setup()
    const router = renderTestList('/items?cursor=c2')
    await screen.findByText('Item 21')

    await user.click(screen.getByRole('button', { name: 'Columns, Items' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).queryByRole('menuitemcheckbox', { name: 'Name' })).not.toBeInTheDocument()
    await user.click(within(menu).getByRole('menuitemcheckbox', { name: 'Status' }))
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ cursor: 'c2', hidden: 'status' })
    )
    expect(screen.queryByRole('columnheader', { name: 'Status' })).not.toBeInTheDocument()

    // A checkbox item leaves the menu open.
    await user.click(within(menu).getByRole('menuitemcheckbox', { name: 'Status' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ cursor: 'c2' }))
  })

  it('does not offer an actions column, and ignores it in ?hidden=', async () => {
    serveTestItems(onePage)
    const user = userEvent.setup()
    renderTestList('/items?hidden=actions')
    await screen.findByText('Item 01')
    expect(screen.getByRole('button', { name: 'Open Item 01' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Columns, Items' }))
    const menu = await screen.findByRole('menu')
    expect(
      within(menu)
        .getAllByRole('menuitemcheckbox')
        .map((item) => item.textContent)
    ).toEqual(['Status', 'Created'])
  })

  it('hides a field of the default card on a phone', async () => {
    atPhoneWidth()
    serveTestItems(onePage)
    const user = userEvent.setup()
    const router = renderTestList()
    const cards = await screen.findByRole('list', { name: 'Items' })
    expect(within(cards).getAllByText('Status')).not.toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Columns, Items' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Status' }))

    await waitFor(() => expect(router.state.location.search).toEqual({ hidden: 'status' }))
    expect(within(cards).queryByText('Status')).not.toBeInTheDocument()
  })

  it('has no column menu for cards that ignore the column choice', async () => {
    serveTestItems(onePage)
    renderTestList('/items', {
      layout: 'cards',
      card: (row) => (
        <div role="listitem" key={row.id}>
          {row.name}
        </div>
      ),
    })
    await screen.findByText('Item 01')
    expect(screen.queryByRole('button', { name: 'Columns, Items' })).not.toBeInTheDocument()
  })

  it('puts the phone sort menu in the toolbar row beside Columns', async () => {
    atPhoneWidth()
    serveTestItems(onePage)
    renderTestList()
    await screen.findByRole('list', { name: 'Items' })
    const columns = screen.getByRole('button', { name: 'Columns, Items' })
    const sort = screen.getByRole('button', { name: 'Sort by, Items' })
    expect(columns.parentElement).toBe(sort.parentElement)
    expect(screen.getAllByRole('button', { name: 'Sort by, Items' })).toHaveLength(1)
  })
})

describe('DataTable total', () => {
  it('asks for the total on the first page only, and keeps it while paging', async () => {
    const seen = serveTestItems(onePage)
    const user = userEvent.setup()
    renderTestList()
    expect(await screen.findByText('25 results')).toBeInTheDocument()
    expect(seen.at(-1)?.get('total')).toBe('1')
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByText('Item 21')
    expect(seen.at(-1)?.get('total')).toBeNull()
    expect(screen.getByText('25 results')).toBeInTheDocument()
  })

  it('says how many rows match, and caps the count', async () => {
    serveTestItems(onePage)
    renderTestList()
    expect(await screen.findByText('25 results')).toBeInTheDocument()
    expect(totalText({ count: 1, capped: false })).toBe('1 result')
    expect(totalText({ count: 1000, capped: true })).toBe('1,000+ results')
    expect(totalText({ count: 1240, capped: false })).toBe('1,240 results')
  })

  it('keeps the total’s live region mounted and changes only its text', async () => {
    serveTestItems((params) =>
      params.get('status') === 'inactive'
        ? listPage([testItem(3, 'inactive')], undefined, { count: 7, capped: false })
        : onePage(params)
    )
    const router = renderTestList()
    const region = (await screen.findByText('25 results')).closest('[role="status"]')!
    await router.navigate({ to: '/items', search: { status: 'inactive' } } as never)
    await waitFor(() => expect(region).toHaveTextContent('7 results'))
    expect(region.isConnected).toBe(true)
  })

  it('renders no toolbar when it has nothing to show, once no total can arrive', async () => {
    serveTestItems(() => listPage([testItem(1)]))
    renderTestList('/items', {
      search: undefined,
      filters: [],
      columns: testColumns.slice(0, 1),
      layout: 'table',
    })
    await screen.findByText('Item 01')
    await waitFor(() =>
      expect(document.querySelector('[data-slot="data-table-toolbar"]')).toBeNull()
    )
  })

  it('keeps a total-only toolbar mounted while the total is still to come', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    serveTestItems(async () => {
      await gate
      return listPage([testItem(1)], undefined, { count: 9, capped: false })
    })
    renderTestList('/items', {
      search: undefined,
      filters: [],
      columns: testColumns.slice(0, 1),
      layout: 'table',
    })
    const slot = '[data-slot="data-table-toolbar"] [role="status"]'
    await waitFor(() => expect(document.querySelector(slot)).not.toBeNull())
    const region = document.querySelector(slot)
    release()
    expect(await screen.findByText('9 results')).toBe(region)
  })

  it('shows no total while the next view’s first page loads, never the old one', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    /** The first page, or the inactive view held back until `release`. */
    const respond = async (params: URLSearchParams) => {
      if (params.get('status') === 'inactive') {
        await gate
        return listPage([testItem(3, 'inactive')], undefined, { count: 7, capped: false })
      }
      return onePage(params)
    }
    serveTestItems(respond)
    const user = userEvent.setup()
    renderTestList()
    expect(await screen.findByText('25 results')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Filter by status, Items' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by status, Items' })
    await user.click(within(popup).getByRole('checkbox', { name: 'Inactive' }))

    await waitFor(() =>
      expect(
        screen.getByRole('table', { name: 'Items' }).closest('[aria-busy="true"]')
      ).not.toBeNull()
    )
    expect(screen.queryByText('25 results')).not.toBeInTheDocument()
    release()
    expect(await screen.findByText('7 results')).toBeInTheDocument()
  })
})
