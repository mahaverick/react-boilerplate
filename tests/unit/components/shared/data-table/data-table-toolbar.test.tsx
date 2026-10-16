import { screen, waitFor, within } from '@testing-library/react'
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

afterEach(() => vi.restoreAllMocks())

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
    await user.type(box, 'ab')
    await waitFor(() => expect(router.state.location.search).toEqual({ search: 'ab' }))
    await user.type(box, 'c')
    expect(box).toHaveValue('abc')
    await waitFor(() => expect(router.state.location.search).toEqual({ search: 'abc' }))
    expect(box).toHaveValue('abc')
  })
})

describe('DataTable facets', () => {
  it('writes a comma list, drops the cursor, and counts the picks on the button', async () => {
    const seen = serveTestItems(onePage)
    const user = userEvent.setup()
    const router = renderTestList('/items?cursor=c2')
    await screen.findByText('Item 21')

    await user.click(screen.getByRole('button', { name: 'Filter by status' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by status' })
    await user.click(within(popup).getByRole('checkbox', { name: 'Active' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ status: 'active' }))
    await user.click(within(popup).getByRole('checkbox', { name: 'Inactive' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ status: 'active,inactive' }))
    await waitFor(() => expect(seen.at(-1)?.get('status')).toBe('active,inactive'))
    expect(seen.at(-1)?.get('cursor')).toBeNull()
    expect(screen.getByRole('button', { name: 'Filter by status, 2 selected' })).toBeInTheDocument()
  })

  it('shows a chip per value, and a chip removes only its own value', async () => {
    serveTestItems(onePage)
    const user = userEvent.setup()
    const router = renderTestList('/items?status=active,inactive')
    await screen.findByText('Item 01')

    await user.click(screen.getByRole('button', { name: 'Remove filter: Status: Active' }))

    await waitFor(() => expect(router.state.location.search).toEqual({ status: 'inactive' }))
    expect(
      screen.getByRole('button', { name: 'Remove filter: Status: Inactive' })
    ).toBeInTheDocument()
  })

  it('writes a yes/no filter as a boolean and keeps one pick at a time', async () => {
    serveTestItems(onePage)
    const user = userEvent.setup()
    const router = renderTestList()
    await screen.findByText('Item 01')
    await user.click(screen.getByRole('button', { name: 'Filter by verified' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by verified' })
    await user.click(within(popup).getByRole('checkbox', { name: 'Unverified' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ verified: false }))
    await user.click(within(popup).getByRole('checkbox', { name: 'Verified' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ verified: true }))
  })

  it('clears a facet with Clear filter', async () => {
    serveTestItems(onePage)
    const user = userEvent.setup()
    const router = renderTestList('/items?status=active&sort=-created')
    await screen.findByText('Item 01')
    await user.click(screen.getByRole('button', { name: 'Filter by status, 1 selected' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by status' })
    await user.click(within(popup).getByRole('button', { name: 'Clear filter' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ sort: '-created' }))
  })

  it('clears the search and every filter with Reset, keeping the sort', async () => {
    serveTestItems(onePage)
    const user = userEvent.setup()
    const router = renderTestList('/items?search=acme&status=active&sort=-created')
    await screen.findByText('Item 01')
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ sort: '-created' }))
    expect(screen.getByRole('searchbox', { name: 'Search items' })).toHaveValue('')
  })

  it('shows no chips or Reset on an unfiltered list', async () => {
    serveTestItems(onePage)
    renderTestList()
    await screen.findByText('Item 01')
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: 'Filter by status' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by status' })
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
    await user.click(screen.getByRole('button', { name: 'Filter by status' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by status' })
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

    await user.click(screen.getByRole('button', { name: 'Columns' }))
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

  it('hides a field of the default card on a phone', async () => {
    atPhoneWidth()
    serveTestItems(onePage)
    const user = userEvent.setup()
    const router = renderTestList()
    const cards = await screen.findByRole('list', { name: 'Items' })
    expect(within(cards).getAllByText('Status')).not.toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Columns' }))
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
    expect(screen.queryByRole('button', { name: 'Columns' })).not.toBeInTheDocument()
  })

  it('puts the phone sort menu in the toolbar row beside Columns', async () => {
    atPhoneWidth()
    serveTestItems(onePage)
    renderTestList()
    await screen.findByRole('list', { name: 'Items' })
    const columns = screen.getByRole('button', { name: 'Columns' })
    const sort = screen.getByRole('button', { name: 'Sort by' })
    expect(columns.parentElement).toBe(sort.parentElement)
    expect(screen.getAllByRole('button', { name: 'Sort by' })).toHaveLength(1)
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

    await user.click(screen.getByRole('button', { name: 'Filter by status' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by status' })
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
