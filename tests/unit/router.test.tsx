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
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { router as appRouter } from '@/router'
import { settle } from '@/tests/fixtures/timing'

/**
 * The app router's route-state options, applied to a small tree of its own.
 * No route in the real tree has a loader that fails on demand, and `$slug`
 * has an `errorComponent` of its own, so the defaults are driven here.
 */
function renderTree(loader: () => unknown, initialPath: string) {
  const {
    defaultErrorComponent,
    defaultNotFoundComponent,
    defaultPendingComponent,
    defaultPendingMs,
    defaultPendingMinMs,
  } = appRouter.options
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
    component: () => <h1>Page</h1>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, pageRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    defaultErrorComponent,
    defaultNotFoundComponent,
    defaultPendingComponent,
    defaultPendingMs,
    defaultPendingMinMs,
  })
  render(<RouterProvider router={router as never} />)
  return router
}

/**
 * Records whether the pending screen was ever in the DOM, however briefly.
 * Reads `addedNodes` off each mutation record rather than querying the live
 * DOM in the callback: React can insert the pending screen and remove it
 * again within the same batch, before the observer callback ever runs, and
 * a query at callback time would miss it entirely.
 */
function watchForPending(): () => boolean {
  let seen = false
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
      within(alert).getByRole('heading', { level: 1, name: 'Something went wrong' })
    ).toBeInTheDocument()
    expect(within(alert).getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/')

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
    expect(alert).toHaveTextContent('Something went wrong')
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

    await user.click(within(alert).getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledOnce()
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
    const { defaultPendingMs = 0, defaultPendingMinMs = 0 } = appRouter.options
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const router = renderTree(() => gate, '/')
    await screen.findByRole('heading', { level: 1, name: 'Home' })

    // Fakes only the clock the router reads: setTimeout and Date.now.
    // setImmediate stays real because React's async act flushes on it. While
    // setTimeout is fake, findBy*/waitFor would hang (their final drain is a
    // setTimeout nothing advances), so this section asserts with getBy* only.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    router.history.push('/page')
    await act(() => vi.advanceTimersByTimeAsync(defaultPendingMs))
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()

    // The loader settles the instant the pending screen appears; with
    // defaultPendingMinMs at 0 it would swap to the page immediately, so
    // this regresses if that floor is ever dropped.
    release()
    await act(() => vi.advanceTimersByTimeAsync(100))
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()

    await act(() => vi.advanceTimersByTimeAsync(defaultPendingMinMs))
    vi.useRealTimers()
    expect(await screen.findByRole('heading', { level: 1, name: 'Page' })).toBeInTheDocument()
  })
})
