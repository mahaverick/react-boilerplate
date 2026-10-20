import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { templatesReady } from '@/components/shared/pending-templates'
import { noteError } from '@/observability/errors'
import { router as appRouter, ROUTER_DEFAULTS } from '@/router'
import { settle } from '@/tests/fixtures/timing'

vi.mock('@/observability/errors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/observability/errors')>()),
  noteError: vi.fn(),
}))

/**
 * The app router's route-state options, applied to a small tree of its own: no route in the
 * real tree has a loader that fails on demand, and `$slug` has its own `errorComponent`, so
 * the defaults are driven here.
 */
function renderTree(
  loader: () => unknown,
  initialPath: string,
  page: () => ReactNode = () => <h1>Page</h1>
) {
  const rootRoute = createRootRoute({ component: Outlet })
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <h1>Home</h1>,
  })
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/page',
    loader,
    component: page,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, pageRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    ...ROUTER_DEFAULTS,
  })
  render(<RouterProvider router={router as never} />)
  return router
}

/**
 * Records whether the pending screen was ever in the DOM, however briefly. It reads
 * `addedNodes` off each mutation record rather than querying the live DOM in the callback,
 * because React can insert the pending screen and remove it within one batch, before the
 * observer runs, and a query at callback time would miss it.
 * @returns A function that stops watching and reports whether the screen was seen.
 */
function watchForPending(): () => boolean {
  let seen = false
  /** Whether `node` is, or contains, the pending screen. */
  const matchesPending = (node: Node) =>
    node instanceof HTMLElement &&
    (node.matches('[role="status"][aria-label="Loading"]') ||
      node.querySelector('[role="status"][aria-label="Loading"]') !== null)
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (matchesPending(node)) seen = true
      })
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    return seen
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('route errors', () => {
  it('shows the error card for a failing loader, and Try again recovers once it succeeds', async () => {
    let failing = true
    renderTree(() => {
      if (failing) throw new Error('loader exploded')
      return null
    }, '/page')
    const user = userEvent.setup()

    const alert = await screen.findByRole('alert')
    expect(
      within(alert).getByRole('heading', { level: 1, name: 'This page didn’t load' })
    ).toBeInTheDocument()
    expect(within(alert).getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/')
    expect(within(alert).getByText('Try again, or go home.')).toBeInTheDocument()

    failing = false
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Page' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the error card for a page that throws while rendering, and Try again recovers', async () => {
    // React reports the caught render error on the console; that is expected here.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let failing = true
    /** Throws while `failing`, to exercise the route error card. */
    function Flaky() {
      if (failing) throw new Error('render exploded')
      return <h1>Page</h1>
    }
    renderTree(() => null, '/page', Flaky)
    const user = userEvent.setup()

    const alert = await screen.findByRole('alert')
    expect(
      within(alert).getByRole('heading', { level: 1, name: 'This page didn’t load' })
    ).toBeInTheDocument()
    expect(alert).toHaveTextContent('render exploded')

    failing = false
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Page' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('takes the reader home from Go home', async () => {
    renderTree(() => {
      throw new Error('loader exploded')
    }, '/page')
    const user = userEvent.setup()

    const alert = await screen.findByRole('alert')
    await user.click(within(alert).getByRole('link', { name: 'Go home' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument()
  })

  it('shows the error message in development', async () => {
    renderTree(() => {
      throw new Error('loader exploded')
    }, '/page')

    expect(await screen.findByRole('alert')).toHaveTextContent('loader exploded')
  })

  it('hides the error message outside development', async () => {
    vi.stubEnv('DEV', false)
    renderTree(() => {
      throw new Error('loader exploded')
    }, '/page')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('This page didn’t load')
    expect(alert).not.toHaveTextContent('loader exploded')
  })

  it('offers a reload, not a retry, when a chunk failed to load', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    renderTree(() => {
      throw new TypeError(
        'Failed to fetch dynamically imported module: http://localhost:3000/assets/page-a1b2.js'
      )
    }, '/page')
    const user = userEvent.setup()

    const alert = await screen.findByRole('alert')
    expect(
      within(alert).getByRole('heading', { level: 1, name: 'A new version is available' })
    ).toBeInTheDocument()
    expect(within(alert).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(within(alert).getByText('Reload to get the latest version.')).toBeInTheDocument()

    await user.click(within(alert).getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledOnce()
  })
})

describe('route errors and error tracking', () => {
  it('notes a loader error as handled, from the router', async () => {
    vi.mocked(noteError).mockClear()
    const error = new Error('loader exploded')
    renderTree(() => {
      throw error
    }, '/page')

    await screen.findByRole('alert')
    expect(noteError).toHaveBeenCalledWith(error, 'router', true)
  })

  it('notes a chunk that failed to load as chunk_load', async () => {
    vi.mocked(noteError).mockClear()
    const error = new TypeError(
      'Failed to fetch dynamically imported module: http://localhost:3000/assets/page-a1b2.js'
    )
    renderTree(() => {
      throw error
    }, '/page')

    await screen.findByRole('heading', { level: 1, name: 'A new version is available' })
    expect(noteError).toHaveBeenCalledWith(error, 'chunk_load', true)
  })

  it('reads the app router’s deepest match as the error route', async () => {
    const { currentRouteId } = await import('@/observability/errors/listen')
    await appRouter.navigate({ to: '/login' })
    expect(currentRouteId()).toEqual(expect.any(String))
    expect(currentRouteId()).toBe(appRouter.state.matches.at(-1)?.routeId)
  })
})

describe('unknown URLs', () => {
  it('shows the not-found card with a way home', async () => {
    renderTree(() => null, '/no-such-page')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' })
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/')
  })
})

describe('pending navigation', () => {
  it('paints the default pending template without suspending once the startup preload has settled', async () => {
    await templatesReady
    const DefaultPending = ROUTER_DEFAULTS.defaultPendingComponent
    // No Suspense boundary: a template that had to suspend would throw here instead of rendering.
    render(<DefaultPending />)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })

  it('shows the pending screen for a navigation slower than 300ms', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const router = renderTree(() => gate, '/')
    await screen.findByRole('heading', { level: 1, name: 'Home' })

    router.history.push('/page')

    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
    release()
    expect(await screen.findByRole('heading', { level: 1, name: 'Page' })).toBeInTheDocument()
  })

  it('never shows the pending screen for a navigation faster than 300ms', async () => {
    const router = renderTree(
      () => settle(50, 'a loader that resolves well inside defaultPendingMs (300)'),
      '/'
    )
    await screen.findByRole('heading', { level: 1, name: 'Home' })
    const pendingWasShown = watchForPending()

    router.history.push('/page')

    expect(await screen.findByRole('heading', { level: 1, name: 'Page' })).toBeInTheDocument()
    expect(pendingWasShown()).toBe(false)
  })

  it('keeps the pending screen up for defaultPendingMinMs even when the loader resolves right away', async () => {
    const { defaultPendingMs, defaultPendingMinMs } = ROUTER_DEFAULTS
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const router = renderTree(() => gate, '/')
    await screen.findByRole('heading', { level: 1, name: 'Home' })

    // Fakes only the clock the router reads (setTimeout, Date); setImmediate stays real because React's async act flushes on it. With setTimeout faked, `findBy` and `waitFor` would hang on their final drain, so this section asserts synchronously.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    router.history.push('/page')
    await act(() => vi.advanceTimersByTimeAsync(defaultPendingMs - 1))
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()

    // The loader settles as soon as the pending screen appears, yet the page must wait out the whole defaultPendingMinMs floor, to the millisecond.
    release()
    await act(() => vi.advanceTimersByTimeAsync(defaultPendingMinMs - 1))
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(screen.getByRole('heading', { level: 1, name: 'Page' })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
  })
})
