import type { RouterHistory } from '@tanstack/react-router'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextSort, showingText } from '@/components/shared/data-table/data-table-model'
import * as analytics from '@/observability/telemetry'
import { listPage } from '@/tests/fixtures/list-page'
import {
  REFUSED_CURSOR,
  renderTestList,
  serveTestItems,
  testItem,
  type TestItem,
} from '@/tests/unit/components/shared/data-table/list-harness'

/** Rows `from` to `to`, inclusive. */
function rows(from: number, to: number): TestItem[] {
  return Array.from({ length: to - from + 1 }, (_, index) => testItem(from + index))
}

/** Page one (rows 1–20, a next page) and page two (rows 21–25, a previous page). */
function twoPages(params: URLSearchParams) {
  if (params.get('cursor') === 'c2')
    return listPage(rows(21, 25), { prevCursor: 'c1', hasPrev: true })
  return listPage(rows(1, 20), { nextCursor: 'c2', hasNext: true }, { count: 25, capped: false })
}

/** A promise the test settles by hand, to hold a response in flight. */
function deferred<T>() {
  /** Replaced by the promise's own resolver below. */
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.restoreAllMocks()
  window.innerWidth = 1024
})

describe('DataTable states', () => {
  it('shows a table-shaped skeleton while the first page loads', async () => {
    serveTestItems(() => new Promise<never>(() => {}))
    renderTestList()
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('names the table, its region and its paging, and gives every header a column scope', async () => {
    serveTestItems(twoPages)
    renderTestList()
    const table = await screen.findByRole('table', { name: 'Items' })
    const region = screen.getByRole('region', { name: 'Items' })
    expect(region).toContainElement(table)
    expect(within(region).getByRole('navigation', { name: 'Items pagination' })).toBeInTheDocument()
    expect(within(table).getByText('Items', { selector: 'caption' })).toHaveClass('sr-only')
    for (const header of within(table).getAllByRole('columnheader')) {
      expect(header).toHaveAttribute('scope', 'col')
    }
  })

  it('offers a retry when the page fails, and the retry asks again', async () => {
    let calls = 0
    serveTestItems(() => (++calls === 1 ? 500 : listPage(rows(1, 2))))
    const user = userEvent.setup()
    renderTestList()
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Item 01')).toBeInTheDocument()
    expect(calls).toBe(2)
  })

  it('says the list’s own failure copy when it gives one', async () => {
    serveTestItems(() => 500)
    renderTestList('/items', { errorMessage: 'We could not load the items.' })
    expect(await screen.findByText('We could not load the items.')).toBeInTheDocument()
  })

  it('leaves the region to its parent with landmark={false}', async () => {
    serveTestItems(twoPages)
    renderTestList('/items', { landmark: false })
    expect(await screen.findByRole('table', { name: 'Items' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Items' })).not.toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Items pagination' })).toBeInTheDocument()
  })

  it('says the list is empty in its own words when nothing is filtered', async () => {
    serveTestItems(() => listPage([]))
    renderTestList()
    expect(await screen.findByText('No items yet.')).toBeInTheDocument()
  })

  it('says nothing matches, with Reset, when a filter is set', async () => {
    serveTestItems(() => listPage([]))
    const user = userEvent.setup()
    const router = renderTestList('/items?status=inactive')
    expect(await screen.findByText('Nothing matches these filters.')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Reset' })[0]!)
    await waitFor(() => expect(router.state.location.search).toEqual({}))
  })

  it('offers the first page again when a later page comes back empty', async () => {
    serveTestItems(() => listPage([]))
    const user = userEvent.setup()
    const router = renderTestList('/items?cursor=c9')
    expect(await screen.findByText('Nothing on this page.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'First page' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
  })

  it('keeps a way back to the first page when a later page fails', async () => {
    serveTestItems((params) => (params.get('cursor') ? 500 : listPage(rows(1, 2))))
    const user = userEvent.setup()
    const router = renderTestList('/items?cursor=c9')
    await screen.findByRole('button', { name: 'Try again' })
    await user.click(screen.getByRole('button', { name: 'First page' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(await screen.findByText('Item 01')).toBeInTheDocument()
  })

  it('goes back to the first page, replacing the entry, when the API refuses the cursor', async () => {
    const seen = serveTestItems((params) =>
      params.get('cursor') ? REFUSED_CURSOR : listPage(rows(1, 2))
    )
    // Watch every DOM change from before the first render: the refused cursor must never show as an error.
    const shownErrors: string[] = []
    const watch = new MutationObserver(() => {
      if (screen.queryByRole('alert')) shownErrors.push('alert')
      for (const name of ['Try again', 'First page']) {
        if (screen.queryByRole('button', { name })) shownErrors.push(name)
      }
    })
    watch.observe(document.body, { childList: true, subtree: true, attributes: true })
    const router = renderTestList('/items?cursor=tampered&sort=-created')
    expect(await screen.findByText('Item 01')).toBeInTheDocument()
    watch.disconnect()
    expect(shownErrors).toEqual([])
    expect(router.state.location.search).toEqual({ sort: '-created' })
    expect(seen.at(-1)?.get('cursor')).toBeNull()
    expect((router.history as RouterHistory).length).toBe(1)
  })

  it('keeps the current rows, marked busy, with paging off while the next page loads', async () => {
    const pageTwo = deferred<ReturnType<typeof listPage<TestItem>>>()
    serveTestItems((params) => (params.get('cursor') === 'c2' ? pageTwo.promise : twoPages(params)))
    const user = userEvent.setup()
    renderTestList()
    await screen.findByText('Item 01')
    await user.click(screen.getByRole('button', { name: 'Next page' }))

    expect(screen.getByText('Item 01').closest('[aria-busy="true"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    pageTwo.resolve(listPage(rows(21, 25), { prevCursor: 'c1', hasPrev: true }))
    expect(await screen.findByText('Item 21')).toBeInTheDocument()
  })

  it('does not say the next view matches nothing while its page is still loading', async () => {
    const filtered = deferred<ReturnType<typeof listPage<TestItem>>>()
    serveTestItems((params) =>
      params.get('status') === 'active' ? filtered.promise : listPage([])
    )
    const router = renderTestList('/items?status=inactive')
    await screen.findByText('Nothing matches these filters.')

    await router.navigate({ to: '/items', search: { status: 'active' } } as never)

    await waitFor(() =>
      expect(screen.queryByText('Nothing matches these filters.')).not.toBeInTheDocument()
    )
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    filtered.resolve(listPage(rows(1, 1)))
    expect(await screen.findByText('Item 01')).toBeInTheDocument()
  })
})

describe('DataTable sorting', () => {
  it('steps a column through its own keys, then back to the default', () => {
    expect(nextSort(['created', '-created'], 'name', 'name')).toBe('created')
    expect(nextSort(['created', '-created'], 'created', 'name')).toBe('-created')
    expect(nextSort(['created', '-created'], '-created', 'name')).toBe('name')
    expect(nextSort(['-created', 'created'], 'created', '-created')).toBe('-created')
    expect(nextSort(['name'], 'name', 'name')).toBe('name')
  })

  it('marks only the sorted column with aria-sort, the default sort included', async () => {
    serveTestItems(twoPages)
    renderTestList()
    const name = await screen.findByRole('columnheader', { name: 'Name' })
    expect(name).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByRole('columnheader', { name: 'Created' })).not.toHaveAttribute('aria-sort')
    expect(screen.getByRole('columnheader', { name: 'Status' })).not.toHaveAttribute('aria-sort')
  })

  it('sorts from the header, writes ?sort=, announces it, and reports it', async () => {
    const track = vi.spyOn(analytics, 'track')
    const seen = serveTestItems(twoPages)
    const user = userEvent.setup()
    const router = renderTestList('/items?cursor=c2')
    await screen.findByText('Item 21')

    await user.click(screen.getByRole('button', { name: 'Created' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ sort: 'created' }))
    expect(screen.getByText('Sorted by Created, oldest first')).toBeInTheDocument()
    expect(await screen.findByRole('columnheader', { name: 'Created' })).toHaveAttribute(
      'aria-sort',
      'ascending'
    )
    await waitFor(() => expect(seen.at(-1)?.get('sort')).toBe('created'))
    expect(seen.at(-1)?.get('cursor')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Created' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ sort: '-created' }))
    expect(screen.getByText('Sorted by Created, newest first')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Created' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(screen.getByText('Sorted by Name, A to Z')).toBeInTheDocument()

    expect(track.mock.calls.filter(([event]) => event === 'table_sorted')).toEqual([
      ['table_sorted', { table: 'test_items', sort: 'created', direction: 'asc' }],
      ['table_sorted', { table: 'test_items', sort: 'created', direction: 'desc' }],
      ['table_sorted', { table: 'test_items', sort: 'created', direction: 'default' }],
    ])
  })

  it('hides the header arrows from assistive tech', async () => {
    serveTestItems(twoPages)
    renderTestList()
    const button = await screen.findByRole('button', { name: 'Created' })
    for (const icon of button.querySelectorAll('svg')) {
      expect(icon).toHaveAttribute('aria-hidden', 'true')
    }
  })
})

describe('DataTable paging', () => {
  it('follows hasPrev and hasNext, and keeps the cursor in the URL', async () => {
    const track = vi.spyOn(analytics, 'track')
    serveTestItems(twoPages)
    const user = userEvent.setup()
    const router = renderTestList()
    await screen.findByText('Item 01')
    const nav = screen.getByRole('navigation', { name: 'Items pagination' })
    expect(within(nav).getByRole('button', { name: 'Previous page' })).toBeDisabled()

    await user.click(within(nav).getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ cursor: 'c2' }))
    expect(await screen.findByText('Item 21')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Previous page' }))
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ cursor: 'c1', direction: 'prev' })
    )
    expect(track.mock.calls.filter(([event]) => event === 'table_paged')).toEqual([
      ['table_paged', { table: 'test_items', direction: 'next' }],
      ['table_paged', { table: 'test_items', direction: 'prev' }],
    ])
  })

  it('counts "Showing" across pages, and from 1 again after a change', async () => {
    serveTestItems(twoPages)
    const user = userEvent.setup()
    renderTestList()
    expect(await screen.findByText('Showing 1–20')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('Showing 21–25')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Created' }))
    expect(await screen.findByText('Showing 1–20')).toBeInTheDocument()
  })

  it('counts from 1 when the API answers a cursor with the first page', async () => {
    // A cursor whose page came back empty: 4a answers with page one, which has no previous page.
    serveTestItems(() =>
      listPage(rows(1, 20), { nextCursor: 'c2', hasNext: true }, { count: 25, capped: false })
    )
    renderTestList('/items?cursor=stale')
    expect(await screen.findByText('Showing 1–20')).toBeInTheDocument()
  })

  it('shows no position when a previous-page cursor is answered with the last page', async () => {
    // A `prev` cursor whose page came back empty: 4a answers with the last page, which has no next page.
    serveTestItems(() => listPage(rows(21, 25), { prevCursor: 'c1', hasPrev: true }))
    renderTestList('/items?cursor=stale&direction=prev')
    expect(await screen.findByText('Item 21')).toBeInTheDocument()
    expect(screen.queryByText(/^Showing /)).not.toBeInTheDocument()
  })

  it('shows no position on a later page this tab did not page to', () => {
    expect(showingText(undefined, 20, 5)).toBeNull()
    expect(showingText(2, 20, 5)).toBe('Showing 41–45')
    expect(showingText(0, 20, 0)).toBeNull()
  })

  it('writes ?limit=, drops the cursor, and leaves the default out', async () => {
    const seen = serveTestItems(twoPages)
    const user = userEvent.setup()
    const router = renderTestList('/items?cursor=c2')
    await screen.findByText('Item 21')

    await user.click(screen.getByRole('combobox', { name: 'Rows per page' }))
    await user.click(await screen.findByRole('option', { name: '50' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ limit: 50 }))
    await waitFor(() => expect(seen.at(-1)?.get('limit')).toBe('50'))

    await user.click(screen.getByRole('combobox', { name: 'Rows per page' }))
    await user.click(await screen.findByRole('option', { name: '20' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
  })
})

describe('DataTable columns', () => {
  it('hides the columns ?hidden= names, never the first', async () => {
    serveTestItems(twoPages)
    renderTestList('/items?hidden=status,name')
    const table = await screen.findByRole('table', { name: 'Items' })
    expect(within(table).queryByRole('columnheader', { name: 'Status' })).not.toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
  })
})

describe('DataTable focus landmarks', () => {
  it('registers each row by id, focusable from code only, when given rowTarget', async () => {
    serveTestItems(twoPages)
    const registered: string[] = []
    renderTestList('/items', {
      rowTarget: (id) => (element) => {
        if (element) registered.push(id)
      },
    })
    const cell = await screen.findByText('Item 01')
    expect(cell.closest('tr')).toHaveAttribute('tabindex', '-1')
    expect(registered).toContain(testItem(1).id)
  })
})

describe('DataTable cards', () => {
  it('stacks one card per row below 768 px, with no table mounted', async () => {
    window.innerWidth = 390
    serveTestItems(twoPages)
    renderTestList()
    const cards = await screen.findByRole('list', { name: 'Items' })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const first = within(cards).getAllByRole('listitem')[0]!
    expect(within(first).getByText('Item 01')).toBeInTheDocument()
    expect(within(first).getByText('Status')).toBeInTheDocument()
    expect(within(first).getByRole('button', { name: 'Open Item 01' })).toBeInTheDocument()
    expect(within(first).queryByText('Actions')).not.toBeInTheDocument()
  })

  it('stacks cards at every width with layout="cards"', async () => {
    serveTestItems(twoPages)
    renderTestList('/items', { layout: 'cards' })
    expect(await screen.findByRole('list', { name: 'Items' })).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('renders a list’s own card when it gives one', async () => {
    serveTestItems(twoPages)
    renderTestList('/items', {
      layout: 'cards',
      card: (row) => <div role="listitem">Custom {row.name}</div>,
    })
    expect(await screen.findByText('Custom Item 01')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Item 01' })).not.toBeInTheDocument()
  })
})
