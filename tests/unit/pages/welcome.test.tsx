import { notifyManager, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
  type RouterHistory,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ROUTES } from '@/constants/routes'
import { resetSessionForTests } from '@/http/session'
import { toast } from '@/lib/toast'
import { tenantKeys } from '@/queries/tenant.queries'
import { queryClient, ROUTER_DEFAULTS } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { useMaintenanceModeStore } from '@/states/maintenance-mode.store'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { fail, ok, tenantDetail, testFlags, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { SLUG_TAKEN } from '@/types/api.types'

const NEW_CO = {
  id: TENANT_ID,
  name: 'New Co',
  slug: 'new-co',
  description: null,
  logo: null,
  website: null,
  lifecycleState: 'active',
  deletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  isPlatform: false,
}

/** `GET /tenants` with `tenants` as the caller's memberships, each as owner. */
function tenantsPage(tenants: (typeof NEW_CO)[]) {
  return ok(
    listPage(
      tenants.map((tenant) => ({
        tenant,
        role: 'owner',
        isPlatform: false,
        joinedAt: '2026-01-01T00:00:00.000Z',
      }))
    ),
    'Tenants retrieved.'
  )
}

/** Mounts the real route tree at `path` and returns the router. */
function renderAppAt(path: string): AnyRouter {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
    ...ROUTER_DEFAULTS,
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  return router as AnyRouter
}

/** Signs `testUser` in, as the boot would have. */
function signIn() {
  useAuthStore.setState({
    accessToken: 'access-token',
    user: testUser,
    isAuthenticated: true,
    isBootstrapped: true,
  })
}

describe('/welcome', () => {
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    signIn()
  })

  afterEach(() => {
    notifyManager.setScheduler((callback) => setTimeout(callback, 0))
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    useMaintenanceModeStore.setState({ mode: 'off', message: null, since: null })
  })

  it('creates the workspace and lands in it', async () => {
    const success = vi.spyOn(toast, 'success')
    let posted: unknown = null
    server.use(
      // The list answers with the new tenant once it exists, as the API would on the refetch a create triggers.
      http.get('/api/v1/tenants', () => tenantsPage(posted ? [NEW_CO] : [])),
      http.post('/api/v1/tenants', async ({ request }) => {
        posted = await request.json()
        return ok(NEW_CO, 'Tenant created.', 201)
      }),
      http.get('/api/v1/tenants/new-co', () => ok(tenantDetail(NEW_CO, 'owner'), 'Tenant.'))
    )
    const user = userEvent.setup()
    const router = renderAppAt('/welcome')

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Create your workspace'
    )
    await user.type(screen.getByLabelText('Name'), '  New Co  ')
    await user.type(screen.getByLabelText('Slug'), 'new-co')
    await user.click(screen.getByRole('button', { name: 'Create workspace' }))

    await screen.findByRole('heading', { name: 'New Co', level: 1 })
    expect(posted).toEqual({ name: 'New Co', slug: 'new-co' })
    // The refetched list now holds a tenant; the page's own landing must win over the has-a-tenant redirect.
    expect(router.state.location.pathname).toBe('/tenants/new-co')
    expect(success).toHaveBeenCalledWith('New Co created.')
    // A replace, so Back does not return to the form.
    expect((router.history as RouterHistory).length).toBe(1)
  })

  it('lands in the new workspace even when the refetched list renders first', async () => {
    // Query notifications run at once here, so the refetched list, which now holds a tenant, renders and starts the has-a-tenant redirect before the create's own landing; the later landing must win.
    notifyManager.setScheduler((callback) => callback())
    let posted: unknown = null
    server.use(
      // The list answers with the new tenant once it exists, as the API would on the refetch a create triggers.
      http.get('/api/v1/tenants', () => tenantsPage(posted ? [NEW_CO] : [])),
      http.post('/api/v1/tenants', async ({ request }) => {
        posted = await request.json()
        return ok(NEW_CO, 'Tenant created.', 201)
      }),
      http.get('/api/v1/tenants/new-co', () => ok(tenantDetail(NEW_CO, 'owner'), 'Tenant.'))
    )
    const user = userEvent.setup()
    const router = renderAppAt('/welcome')

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Create your workspace'
    )
    await user.type(screen.getByLabelText('Name'), '  New Co  ')
    await user.type(screen.getByLabelText('Slug'), 'new-co')
    await user.click(screen.getByRole('button', { name: 'Create workspace' }))

    await screen.findByRole('heading', { name: 'New Co', level: 1 })
    expect(router.state.location.pathname).toBe('/tenants/new-co')
  })

  it('lands in the new workspace when the refetched list renders while the landing loads', async () => {
    // A browser order: the landing's loader waits on the tenant's flags, and the list refetch the create started renders this page meanwhile, now holding the tenant.
    let posted: unknown = null
    let listReads = 0
    let releaseFlags: (() => void) | undefined
    server.use(
      http.get('/api/v1/tenants', () => {
        listReads += 1
        return tenantsPage(posted ? [NEW_CO] : [])
      }),
      http.post('/api/v1/tenants', async ({ request }) => {
        posted = await request.json()
        return ok(NEW_CO, 'Tenant created.', 201)
      }),
      http.get('/api/v1/tenants/new-co', () => ok(tenantDetail(NEW_CO, 'owner'), 'Tenant.')),
      http.get('/api/v1/tenants/new-co/flags', async () => {
        await new Promise<void>((resolve) => (releaseFlags = resolve))
        return ok(testFlags(), 'Flags retrieved.')
      })
    )
    const user = userEvent.setup()
    const router = renderAppAt('/welcome')

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Create your workspace'
    )
    await user.type(screen.getByLabelText('Name'), 'New Co')
    await user.type(screen.getByLabelText('Slug'), 'new-co')
    await user.click(screen.getByRole('button', { name: 'Create workspace' }))

    // The barrier: the landing waits on the flags, and the refetched list, holding the tenant, has been read.
    await waitFor(() => {
      expect(releaseFlags).toBeDefined()
    })
    await waitFor(() => {
      expect(listReads).toBe(2)
    })
    await waitFor(() => {
      expect(queryClient.getQueryData(tenantKeys.list)).toHaveLength(1)
    })
    releaseFlags?.()

    await screen.findByRole('heading', { name: 'New Co', level: 1 })
    expect(router.state.location.pathname).toBe('/tenants/new-co')
  })

  it('lands in the new workspace when the first list read failed', async () => {
    // A failed first read names no tenant; the refetch the create starts is the first answer that holds one.
    let posted: unknown = null
    let releaseFlags: (() => void) | undefined
    server.use(
      http.get('/api/v1/tenants', () =>
        posted ? tenantsPage([NEW_CO]) : fail('Something went wrong', 500)
      ),
      http.post('/api/v1/tenants', async ({ request }) => {
        posted = await request.json()
        return ok(NEW_CO, 'Tenant created.', 201)
      }),
      http.get('/api/v1/tenants/new-co', () => ok(tenantDetail(NEW_CO, 'owner'), 'Tenant.')),
      http.get('/api/v1/tenants/new-co/flags', async () => {
        await new Promise<void>((resolve) => (releaseFlags = resolve))
        return ok(testFlags(), 'Flags retrieved.')
      })
    )
    const user = userEvent.setup()
    const router = renderAppAt('/welcome')

    await waitFor(() => expect(queryClient.getQueryState(tenantKeys.list)?.status).toBe('error'))
    await user.type(await screen.findByLabelText('Name'), 'New Co')
    await user.type(screen.getByLabelText('Slug'), 'new-co')
    await user.click(screen.getByRole('button', { name: 'Create workspace' }))

    // The barrier: the landing waits on the flags, and the refetched list, holding the tenant, is in the cache.
    await waitFor(() => {
      expect(releaseFlags).toBeDefined()
    })
    await waitFor(() => {
      expect(queryClient.getQueryData(tenantKeys.list)).toHaveLength(1)
    })
    releaseFlags?.()

    await screen.findByRole('heading', { name: 'New Co', level: 1 })
    expect(router.state.location.pathname).toBe('/tenants/new-co')
  })

  it('holds the form back until the first list read settles', async () => {
    // A submit while the first read is pending would make the create's refetch the first answer, and that one holds the new tenant.
    let listRequested = false
    let releaseList: (() => void) | undefined
    server.use(
      http.get('/api/v1/tenants', async () => {
        listRequested = true
        await new Promise<void>((resolve) => (releaseList = resolve))
        return tenantsPage([])
      })
    )
    renderAppAt('/welcome')

    await waitFor(() => {
      expect(listRequested).toBe(true)
    })
    expect(document.querySelector('[data-slot="auth-frame-skeleton"]')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create workspace' })).not.toBeInTheDocument()

    releaseList?.()
    expect(await screen.findByRole('button', { name: 'Create workspace' })).toBeInTheDocument()
  })

  it('sends a user who has a tenant to the dashboard', async () => {
    let releaseFlags: (() => void) | undefined
    server.use(
      http.get('/api/v1/tenants', () => tenantsPage([NEW_CO])),
      // The shell's flags read holds the dashboard, so the frame before it can be seen.
      http.get('/api/v1/flags', async () => {
        await new Promise<void>((resolve) => (releaseFlags = resolve))
        return ok(testFlags(), 'Flags retrieved.')
      })
    )
    const router = renderAppAt('/welcome')

    // Until the dashboard lands, the page shows its skeleton, never a blank frame or the form.
    await waitFor(() =>
      expect(document.querySelector('[data-slot="auth-button-skeleton"]')).not.toBeNull()
    )
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create workspace' })).not.toBeInTheDocument()

    await waitFor(() => expect(releaseFlags).toBeDefined())
    releaseFlags?.()
    await waitFor(() => expect(router.state.location.pathname).toBe(ROUTES.dashboard))
    expect((router.history as RouterHistory).length).toBe(1)
  })

  it('goes to the dashboard, which stays put and offers the workspace prompt', async () => {
    const user = userEvent.setup()
    const router = renderAppAt('/welcome')

    await user.click(await screen.findByRole('link', { name: 'Go to the dashboard' }))

    // The prompt renders once the dashboard has read the empty list, so a redirect back would have fired by then.
    const prompt = await screen.findByRole('link', { name: 'Create your workspace' })
    expect(prompt).toHaveAttribute('href', ROUTES.welcome)
    expect(router.state.location.pathname).toBe(ROUTES.dashboard)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome back')
  })

  it('never shows Creating… for a submit that fails validation', async () => {
    const user = userEvent.setup()
    renderAppAt('/welcome')
    const button = await screen.findByRole('button', { name: 'Create workspace' })
    // Records every label the button shows, so a one-render flash is caught too.
    const labels: string[] = []
    const observer = new MutationObserver(() => labels.push(button.textContent))
    observer.observe(button, { childList: true, subtree: true, characterData: true })

    await user.type(screen.getByLabelText('Slug'), 'acme')
    await user.click(button)
    expect(await screen.findByText('Name is required.')).toBeInTheDocument()
    observer.disconnect()

    expect(labels.filter((label) => label.includes('Creating'))).toEqual([])
  })

  it('shows the form when the tenant list fails to load', async () => {
    server.use(http.get('/api/v1/tenants', () => fail('Something went wrong', 500)))
    const router = renderAppAt('/welcome')

    expect(await screen.findByRole('button', { name: 'Create workspace' })).toBeInTheDocument()
    await waitFor(() => expect(queryClient.getQueryState(tenantKeys.list)?.status).toBe('error'))
    expect(router.state.location.pathname).toBe('/welcome')
  })

  it('sends a signed-out visitor to /login with the way back', async () => {
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
    server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
    const router = renderAppAt('/welcome')

    await waitFor(() => expect(router.state.location.pathname).toBe(ROUTES.login))
    expect(router.state.location.search).toMatchObject({ redirect: '/welcome' })
  })

  it('keeps the URL under full maintenance, signed out', async () => {
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: true,
    })
    useMaintenanceModeStore.setState({ mode: 'full', message: null, since: null })
    server.use(
      http.post('/api/v1/auth/refresh', () => fail("You're signed out. Sign in to continue.", 401)),
      http.get('/api/v1/status/maintenance', () =>
        ok({ mode: 'full', message: 'Upgrading.', since: null }, 'Maintenance status retrieved.')
      )
    )
    const router = renderAppAt('/welcome')

    await screen.findByRole('heading', { name: 'Maintenance in progress' })
    expect(router.state.location.pathname).toBe('/welcome')
  })

  it('shows the slug rule live and the server’s slug_taken under its field', async () => {
    server.use(
      http.post('/api/v1/tenants', () =>
        fail('Another workspace uses this slug. Choose a different one.', 409, SLUG_TAKEN)
      )
    )
    const user = userEvent.setup()
    renderAppAt('/welcome')

    const slug = await screen.findByLabelText('Slug')
    await user.type(slug, 'MyOrg')
    expect(await screen.findByText(/must be lowercase letters/i)).toBeInTheDocument()

    await user.clear(slug)
    await user.type(slug, 'new-co')
    await user.type(screen.getByLabelText('Name'), 'New Co')
    await user.click(screen.getByRole('button', { name: 'Create workspace' }))

    await waitFor(() => expect(slug).toHaveAttribute('aria-invalid', 'true'))
    expect(slug).toHaveAccessibleDescription(
      expect.stringContaining('Another workspace uses this slug. Choose a different one.')
    )
  })

  it('names the account, offers a skip to the dashboard and signs out', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    let loggedOut = false
    server.use(
      http.post('/api/v1/auth/logout', () => {
        loggedOut = true
        return ok(null, 'Signed out.')
      })
    )
    const user = userEvent.setup()
    renderAppAt('/welcome')

    // After the form: until the first list read settles, the main is the pending frame's.
    await screen.findByRole('button', { name: 'Create workspace' })
    const main = screen.getByRole('main')
    const signedInAs = within(main).getByText(testUser.email)
    expect(signedInAs).toHaveClass('ph-sensitive')
    expect(signedInAs.parentElement).toHaveTextContent(`You’re signed in as ${testUser.email}.`)
    expect(within(main).getByRole('link', { name: 'Go to the dashboard' })).toHaveAttribute(
      'href',
      ROUTES.dashboard
    )

    await user.click(within(main).getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith(ROUTES.login))
    expect(loggedOut).toBe(true)
  })
})
