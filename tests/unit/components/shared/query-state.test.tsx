import {
  keepPreviousData,
  QueryClient,
  QueryClientProvider,
  useQuery,
  type QueryKey,
} from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { QueryState } from '@/components/shared/query-state'

vi.mock('@/lib/role-denied', () => ({
  isRoleDenied: (error: unknown) => error instanceof Error && error.message === 'denied',
}))

/** A promise and the function that settles it, for a read a test answers by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let client: QueryClient

afterEach(() => {
  client.clear()
})

/** Renders one section reading `read` under QueryState. */
function renderSection(
  read: (page: number) => Promise<string[]>,
  options: {
    isEmpty?: (data: string[]) => boolean
    errorMessage?: string
    placeholder?: boolean
    /** The section's content for its rows; their names joined by default. */
    content?: (rows: string[]) => ReactNode
  } = {}
) {
  const content = options.content ?? ((rows: string[]) => <p>{rows.join(', ')}</p>)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  /** The section, with a button that moves to the next page of its read. */
  function Section() {
    const [page, setPage] = useState(1)
    const key: QueryKey = ['section', page]
    const query = useQuery({
      queryKey: key,
      queryFn: () => read(page),
      placeholderData: options.placeholder ? keepPreviousData : undefined,
    })
    return (
      <>
        <button type="button" onClick={() => setPage((value) => value + 1)}>
          Next page
        </button>
        <QueryState
          query={query}
          name="Members"
          skeleton={<p>Skeleton</p>}
          isEmpty={options.isEmpty}
          empty={<p>No members</p>}
          errorMessage={options.errorMessage}
        >
          {content}
        </QueryState>
      </>
    )
  }
  return render(
    <QueryClientProvider client={client}>
      <Section />
    </QueryClientProvider>
  )
}

/** The wrapper QueryState renders around every state. */
function wrapper(container: HTMLElement) {
  return container.querySelector('[data-slot="query-state"]')
}

describe('QueryState', () => {
  it('shows the skeleton, marked busy, until the first data arrives', async () => {
    const read = deferred<string[]>()
    const { container } = renderSection(() => read.promise)
    expect(screen.getByText('Skeleton')).toBeInTheDocument()
    expect(wrapper(container)).toHaveAttribute('aria-busy', 'true')
    await act(() => Promise.resolve(read.resolve(['Ada'])))
    expect(await screen.findByText('Ada')).toBeInTheDocument()
    expect(screen.queryByText('Skeleton')).not.toBeInTheDocument()
    expect(wrapper(container)).not.toHaveAttribute('aria-busy')
  })

  it('shows the role refusal for a denied read', async () => {
    renderSection(() => Promise.reject(new Error('denied')))
    expect(await screen.findByRole('alert')).toHaveTextContent('Your role can’t see this any more.')
    expect(screen.queryByText('Skeleton')).not.toBeInTheDocument()
  })

  it('shows LoadError with its default copy, and Try again reads again', async () => {
    const read = vi
      .fn<(page: number) => Promise<string[]>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(['Ada'])
    renderSection(read)
    expect(await screen.findByRole('alert')).toHaveTextContent('Members didn’t load. Try again.')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Ada')).toBeInTheDocument()
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('uses the section’s own error copy when it has one', async () => {
    renderSection(() => Promise.reject(new Error('boom')), {
      errorMessage: 'We could not load the members.',
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load the members.')
  })

  it('shows the empty state when the data is empty', async () => {
    renderSection(() => Promise.resolve([]), { isEmpty: (rows) => rows.length === 0 })
    expect(await screen.findByText('No members')).toBeInTheDocument()
  })

  it('renders nothing, not even its wrapper, once the content is null', async () => {
    const { container } = renderSection(() => Promise.resolve(['Ada']), { content: () => null })
    expect(wrapper(container)).not.toBeNull()
    await waitFor(() => expect(wrapper(container)).toBeNull())
    expect(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument()
  })

  it('still shows a failed refetch above content that is null', async () => {
    const read = vi
      .fn<(page: number) => Promise<string[]>>()
      .mockResolvedValueOnce(['Ada'])
      .mockRejectedValueOnce(new Error('boom'))
    const { container } = renderSection(read, { content: () => null })
    await waitFor(() => expect(wrapper(container)).toBeNull())
    await act(async () => {
      await client.refetchQueries({ queryKey: ['section'] })
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Members didn’t load. Try again.')
    expect(wrapper(container)).not.toBeNull()
  })

  it('renders the content inside a boundary named after the section', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    client = new QueryClient()
    /** A section whose content throws while rendering. */
    function Exploding() {
      const query = useQuery({ queryKey: ['boom'], queryFn: () => Promise.resolve(1) })
      return (
        <QueryState query={query} name="Members" skeleton={<p>Skeleton</p>}>
          {() => {
            throw new Error('render failed')
          }}
        </QueryState>
      )
    }
    render(
      <QueryClientProvider client={client}>
        <Exploding />
        <p>Sibling still here</p>
      </QueryClientProvider>
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Members didn’t load. Reload the page to try again.'
    )
    expect(screen.getByText('Sibling still here')).toBeInTheDocument()
  })

  it('contains a throwing isEmpty to its own section', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    client = new QueryClient()
    /** A section whose emptiness check throws. */
    function Exploding() {
      const query = useQuery({ queryKey: ['boom-empty'], queryFn: () => Promise.resolve(1) })
      return (
        <QueryState
          query={query}
          name="Members"
          skeleton={<p>Skeleton</p>}
          isEmpty={() => {
            throw new Error('empty check failed')
          }}
        >
          {() => <p>Content</p>}
        </QueryState>
      )
    }
    render(
      <QueryClientProvider client={client}>
        <Exploding />
        <p>Sibling still here</p>
      </QueryClientProvider>
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Members didn’t load. Reload the page to try again.'
    )
    expect(screen.getByText('Sibling still here')).toBeInTheDocument()
  })

  it('keeps a placeholder’s rows on screen, marked busy, while the next page loads', async () => {
    const second = deferred<string[]>()
    const { container } = renderSection(
      (page) => (page === 1 ? Promise.resolve(['Ada']) : second.promise),
      { placeholder: true }
    )
    expect(await screen.findByText('Ada')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(screen.queryByText('Skeleton')).not.toBeInTheDocument()
    expect(wrapper(container)).toHaveAttribute('aria-busy', 'true')
    await act(() => Promise.resolve(second.resolve(['Grace'])))
    expect(await screen.findByText('Grace')).toBeInTheDocument()
    expect(wrapper(container)).not.toHaveAttribute('aria-busy')
  })

  it('keeps the content and adds the error when a refetch fails', async () => {
    const read = vi
      .fn<(page: number) => Promise<string[]>>()
      .mockResolvedValueOnce(['Ada'])
      .mockRejectedValueOnce(new Error('boom'))
    renderSection(read)
    expect(await screen.findByText('Ada')).toBeInTheDocument()
    await act(async () => {
      await client.refetchQueries({ queryKey: ['section'] })
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Members didn’t load. Try again.')
    expect(screen.getByText('Ada')).toBeInTheDocument()
  })

  it('replaces the content when a refetch is refused for the role', async () => {
    const read = vi
      .fn<(page: number) => Promise<string[]>>()
      .mockResolvedValueOnce(['Ada'])
      .mockRejectedValueOnce(new Error('denied'))
    renderSection(read)
    expect(await screen.findByText('Ada')).toBeInTheDocument()
    await act(async () => {
      await client.refetchQueries({ queryKey: ['section'] })
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Your role can’t see this any more.')
    expect(screen.queryByText('Ada')).not.toBeInTheDocument()
  })
})
