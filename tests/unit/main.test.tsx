import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router'
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { router as appRouter } from '@/router'

/**
 * Mirrors main.tsx's boot sequence, StrictMode included: `router.load()`
 * resolves (or fails) the first match set before React ever touches
 * `#root`, so the static splash index.html ships there stays up as one
 * piece of markup until there is a real match to show instead. It cannot
 * import `main.tsx` directly — that module renders the real app router into
 * the real `document` as an import side effect — so it reconstructs the
 * same sequence against a tree of its own, the way
 * `tests/unit/router.test.tsx` already does for route state.
 */
function boot(container: HTMLElement, router: AnyRouter) {
  const root = createRoot(container)
  return router.load().finally(() => {
    root.render(
      <StrictMode>
        <RouterProvider router={router as never} />
      </StrictMode>
    )
  })
}

/** The app router's route-state options, applied to a small tree of its own. */
function buildGatedRouter(gate: Promise<void>) {
  const {
    defaultErrorComponent,
    defaultNotFoundComponent,
    defaultPendingComponent,
    defaultPendingMs,
    defaultPendingMinMs,
  } = appRouter.options
  const rootRoute = createRootRoute({ beforeLoad: () => gate })
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <h1>Page</h1>,
  })
  return createRouter({
    routeTree: rootRoute.addChildren([pageRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    defaultErrorComponent,
    defaultNotFoundComponent,
    defaultPendingComponent,
    defaultPendingMs,
    defaultPendingMinMs,
  })
}

/** The exact static markup index.html ships inside `#root`. */
function mountSplashContainer(): HTMLElement {
  const container = document.createElement('div')
  container.id = 'root'
  container.innerHTML =
    '<div class="boot-splash" role="status"><span class="boot-splash-spinner" aria-hidden="true"></span><span>Loading…</span></div>'
  document.body.appendChild(container)
  return container
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the boot sequence', () => {
  it('keeps the splash on screen with no blank gap and no second spinner until the first load resolves', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const router = buildGatedRouter(gate)
    const container = mountSplashContainer()

    let sawEmpty = false
    let sawPendingScreen = false
    const observer = new MutationObserver((mutations) => {
      if (container.innerHTML.trim() === '') sawEmpty = true
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          const isPendingScreen =
            node instanceof HTMLElement &&
            (node.matches('[role="status"][aria-label="Loading"]') ||
              node.querySelector('[role="status"][aria-label="Loading"]') !== null)
          if (isPendingScreen) sawPendingScreen = true
        })
      }
    })
    observer.observe(container, { childList: true, subtree: true })

    const loaded = boot(container, router)

    // Well past defaultPendingMs (300), long enough to catch a boot sequence
    // that renders before the load resolves.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500))
    })
    expect(container.querySelector('.boot-splash')).not.toBeNull()

    release()
    await act(async () => {
      await loaded
    })

    observer.disconnect()
    expect(sawEmpty).toBe(false)
    expect(sawPendingScreen).toBe(false)
    expect(container.querySelector('h1')?.textContent).toBe('Page')
  })

  it('does not run beforeLoad twice when the router mounts after load() has already resolved', async () => {
    const {
      defaultErrorComponent,
      defaultNotFoundComponent,
      defaultPendingComponent,
      defaultPendingMs,
      defaultPendingMinMs,
    } = appRouter.options
    let calls = 0
    const rootRoute = createRootRoute({
      beforeLoad: () => {
        calls += 1
      },
    })
    const pageRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => <h1>Page</h1>,
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([pageRoute]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
      defaultErrorComponent,
      defaultNotFoundComponent,
      defaultPendingComponent,
      defaultPendingMs,
      defaultPendingMinMs,
    })
    const container = mountSplashContainer()

    await act(async () => {
      await boot(container, router)
    })

    expect(calls).toBe(1)
    expect(container.querySelector('h1')?.textContent).toBe('Page')
  })

  it('renders the router-wide error screen when the first load itself fails', async () => {
    const {
      defaultErrorComponent,
      defaultPendingComponent,
      defaultPendingMs,
      defaultPendingMinMs,
    } = appRouter.options
    const rootRoute = createRootRoute({
      beforeLoad: () => {
        throw new Error('boot exploded')
      },
    })
    const pageRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => <h1>Page</h1>,
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([pageRoute]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
      defaultErrorComponent,
      defaultPendingComponent,
      defaultPendingMs,
      defaultPendingMinMs,
    })
    const container = mountSplashContainer()

    await act(async () => {
      await boot(container, router)
    })

    const alert = container.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert?.textContent).toContain('Something went wrong')
  })
})
