import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  type AsyncRouteComponent,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import * as module from '@/components/shared/pending-templates'
import { ROUTER_DEFAULTS } from '@/router'

describe('pending templates', () => {
  it.each(
    Object.entries(module).filter(
      (entry): entry is [string, AsyncRouteComponent<unknown>] => entry[0] !== 'templatesReady'
    )
  )('%s renders without suspending once the module has loaded', async (_name, Template) => {
    // No Suspense boundary: a template still being fetched would throw here instead of rendering.
    await Template.preload?.()
    render(<Template />)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })

  it('shows a nested route its own template inside the layout, not an ancestor fallback', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const rootRoute = createRootRoute({ component: Outlet })
    const layout = createRoute({
      getParentRoute: () => rootRoute,
      id: 'layout',
      component: () => (
        <div>
          <nav aria-label="Sidebar">Sidebar</nav>
          <Outlet />
        </div>
      ),
    })
    const home = createRoute({
      getParentRoute: () => layout,
      path: '/',
      component: () => <h1>Home</h1>,
    })
    const detail = createRoute({
      getParentRoute: () => layout,
      path: '/detail',
      loader: () => gate,
      pendingComponent: module.DetailPending,
      component: () => <h1>Detail</h1>,
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([layout.addChildren([home, detail])]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
      ...ROUTER_DEFAULTS,
    })
    render(<RouterProvider router={router as never} />)
    await screen.findByRole('heading', { level: 1, name: 'Home' })

    router.history.push('/detail')

    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Sidebar' })).toBeInTheDocument()
    release()
    expect(await screen.findByRole('heading', { level: 1, name: 'Detail' })).toBeInTheDocument()
  })
})
