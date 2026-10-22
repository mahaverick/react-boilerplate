import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axeCore from 'axe-core'
import { AxiosError, type AxiosResponse } from 'axios'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { recordRecent } from '@/components/shared/command-palette/recent-items'
import { isRoleDenied } from '@/lib/role-denied'
import * as analytics from '@/observability/telemetry'
import { useAuthStore } from '@/states/auth.store'
import { useCommandPaletteStore } from '@/states/command-palette.store'
import { listPage } from '@/tests/fixtures/list-page'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { LIST_SEARCH_DEBOUNCE_MS } from '@/types/list.types'
import { ACME, CLEO, renderPalette, serveEmptySearches } from './palette-harness'

/** The status this app reads as a role refusal: react's tenant routes answer 403, apex's platform routes 404. */
const REFUSAL_STATUS =
  [403, 404].find((status) =>
    isRoleDenied(
      new AxiosError('refused', undefined, undefined, undefined, { status } as AxiosResponse)
    )
  ) ?? 403

/** Presses the shortcut and returns the palette once its input has focus, so the next keys reach it. */
async function pressShortcut(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Control>}k{/Control}')
  const palette = await screen.findByRole('dialog', { name: 'Command palette' })
  await waitFor(() => expect(within(palette).getByRole('combobox')).toHaveFocus())
  return palette
}

/** Opens the palette with the shortcut once the first page has rendered. */
async function openWithShortcut(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: '/overview' })
  return pressShortcut(user)
}

describe('CommandPaletteShell', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: testUser, isAuthenticated: true })
    useCommandPaletteStore.setState({ open: false, query: '' })
    localStorage.clear()
    serveEmptySearches()
  })

  afterEach(() => {
    useCommandPaletteStore.setState({ open: false, query: '' })
    vi.restoreAllMocks()
  })

  describe('the typed term', () => {
    it('opens showing the store’s term, with the caret after it', async () => {
      useCommandPaletteStore.setState({ open: true, query: 'acm' })
      const user = userEvent.setup()
      renderPalette()
      const input = await screen.findByRole('combobox')
      await waitFor(() => expect(input).toHaveFocus())
      expect(input).toHaveValue('acm')
      await user.keyboard('e')
      expect(input).toHaveValue('acme')
    })
  })

  describe('the shortcut', () => {
    it('opens on Ctrl+K off Apple platforms', async () => {
      vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
      const user = userEvent.setup()
      renderPalette()
      expect(await openWithShortcut(user)).toBeInTheDocument()
    })

    it('opens on Meta+K on Apple platforms', async () => {
      vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
      const user = userEvent.setup()
      renderPalette()
      await screen.findByRole('heading', { name: '/overview' })
      await user.keyboard('{Meta>}k{/Meta}')
      expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it.each([
      ['a repeat', { repeat: true }],
      ['an IME composition', { isComposing: true }],
      ['Shift', { shiftKey: true }],
      ['Alt', { altKey: true }],
      ['no modifier', { ctrlKey: false }],
      ['another key', { code: 'KeyJ', key: 'j' }],
    ])('ignores the shortcut with %s', async (_label, overrides) => {
      renderPalette()
      await screen.findByRole('heading', { name: '/overview' })
      fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true, ...overrides })
      expect(useCommandPaletteStore.getState().open).toBe(false)
    })

    it('ignores a shortcut something else already handled', async () => {
      renderPalette()
      await screen.findByRole('heading', { name: '/overview' })
      /** Stands in for another handler that claims the shortcut by calling `preventDefault`. */
      const claim = (event: Event) => event.preventDefault()
      window.addEventListener('keydown', claim, { capture: true })
      try {
        fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true })
      } finally {
        window.removeEventListener('keydown', claim, { capture: true })
      }
      expect(useCommandPaletteStore.getState().open).toBe(false)
    })

    it('opens on the physical K key on a non-Latin layout', async () => {
      vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
      renderPalette()
      await screen.findByRole('heading', { name: '/overview' })
      fireEvent.keyDown(window, { key: 'л', code: 'KeyK', metaKey: true })
      expect(useCommandPaletteStore.getState().open).toBe(true)
    })

    it('focuses the input on open and gives focus back to what had it on close', async () => {
      const user = userEvent.setup()
      renderPalette()
      await screen.findByRole('heading', { name: '/overview' })
      const trigger = document.createElement('button')
      document.body.append(trigger)
      try {
        trigger.focus()
        const palette = await pressShortcut(user)
        expect(within(palette).getByRole('combobox')).toHaveFocus()

        await user.keyboard('{Escape}')
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        await waitFor(() => expect(trigger).toHaveFocus())
      } finally {
        trigger.remove()
      }
    })

    it('opens empty after the shortcut closed it mid-search', async () => {
      const user = userEvent.setup()
      renderPalette()
      await openWithShortcut(user)
      await user.keyboard('ov')
      expect(screen.getByRole('combobox')).toHaveValue('ov')

      await user.keyboard('{Control>}k{/Control}')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await pressShortcut(user)

      expect(screen.getByRole('combobox')).toHaveValue('')
    })
  })

  describe('searching', () => {
    it('never acts on a previous term’s tenants', async () => {
      let release: (() => void) | undefined
      server.use(
        http.get('/api/v1/palette-test/tenants', async ({ request }) => {
          if (new URL(request.url).searchParams.get('search') === 'acmez') {
            await new Promise<void>((resolve) => {
              release = resolve
            })
            return ok(listPage([]))
          }
          return ok(listPage([ACME]))
        })
      )
      const user = userEvent.setup()
      renderPalette()
      await openWithShortcut(user)
      await user.keyboard('acme')
      await screen.findByRole('option', { name: /Acme Corp/ })

      try {
        await user.keyboard('z')
        // The new term's request is in flight: the window a stale list could take the Enter.
        await waitFor(() => expect(release).toBeDefined())
        expect(screen.queryByRole('option', { name: /Acme Corp/ })).not.toBeInTheDocument()
      } finally {
        release?.()
      }
      await waitFor(() => expect(screen.queryByText('Searching…')).not.toBeInTheDocument())
    })

    it('never acts on a previous term’s users', async () => {
      let release: (() => void) | undefined
      server.use(
        http.get('/api/v1/palette-test/users', async ({ request }) => {
          if (new URL(request.url).searchParams.get('search') === 'cleox') {
            await new Promise<void>((resolve) => {
              release = resolve
            })
            return ok(listPage([]))
          }
          return ok(listPage([CLEO]))
        })
      )
      const user = userEvent.setup()
      const router = renderPalette()
      await openWithShortcut(user)
      await user.keyboard('cleo')
      await screen.findByRole('option', { name: /cleo@example\.com/ })

      try {
        await user.keyboard('x')
        await waitFor(() =>
          expect(
            screen.queryByRole('option', { name: /cleo@example\.com/ })
          ).not.toBeInTheDocument()
        )
        // The new term's request is in flight: the window a stale list could take the Enter.
        await waitFor(() => expect(release).toBeDefined())
        await user.keyboard('{Enter}')
        expect(router.state.location.pathname).toBe('/overview')
      } finally {
        release?.()
      }
      await waitFor(() => expect(screen.queryByText('Searching…')).not.toBeInTheDocument())
    })

    it('ignores Enter typed before the new term is searched', async () => {
      server.use(http.get('/api/v1/palette-test/tenants', () => ok(listPage([ACME]))))
      const user = userEvent.setup()
      const router = renderPalette()
      await openWithShortcut(user)
      await user.keyboard('acme')
      await screen.findByRole('option', { name: /Acme Corp/ })

      await user.keyboard('z{Enter}')
      // The new term's results arrive after the Enter: had it acted, it would already have navigated.
      expect(await screen.findByRole('option', { name: /Acme Corp/ })).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/overview')
      expect(useCommandPaletteStore.getState().open).toBe(true)
    })

    it('does not say "No results." while a search is pending', async () => {
      let release: (() => void) | undefined
      server.use(
        http.get('/api/v1/palette-test/tenants', async () => {
          await new Promise<void>((resolve) => {
            release = resolve
          })
          return ok(listPage([]))
        })
      )
      const user = userEvent.setup()
      renderPalette()
      await openWithShortcut(user)
      try {
        await user.keyboard('zzz')
        await waitFor(() => expect(release).toBeDefined())
        expect(screen.getByText('Searching…')).toHaveAttribute('role', 'status')
        expect(screen.queryByText('No results.')).not.toBeInTheDocument()
      } finally {
        release?.()
      }
      expect(await screen.findByText('No results.')).toBeInTheDocument()
    })

    it('keeps the status line empty, and taking no room, when nothing is pending', async () => {
      const user = userEvent.setup()
      renderPalette()
      await openWithShortcut(user)
      const status = document.querySelector('p[role="status"]')
      expect(status).toBeEmptyDOMElement()
      expect(status).toHaveClass('empty:p-0')
    })

    it('says nothing about a search the role refuses', async () => {
      server.use(http.get('/api/v1/palette-test/tenants', () => fail('Refused', REFUSAL_STATUS)))
      const user = userEvent.setup()
      renderPalette()
      await openWithShortcut(user)
      await user.keyboard('o')

      expect(await screen.findByText('Searching…')).toBeInTheDocument()
      await waitFor(() => expect(screen.queryByText('Searching…')).not.toBeInTheDocument())
      expect(screen.queryByRole('option', { name: 'Search failed. Try again' })).toBeNull()
      expect(screen.getByRole('option', { name: 'Overview' })).toBeInTheDocument()
    })

    it('never searches for a caller who may not', async () => {
      let calls = 0
      server.use(
        http.get('/api/v1/palette-test/tenants', () => {
          calls += 1
          return ok(listPage([ACME]))
        })
      )
      const user = userEvent.setup()
      renderPalette({ canSearch: false })
      await openWithShortcut(user)
      await user.keyboard('acme')

      await settle(
        LIST_SEARCH_DEBOUNCE_MS * 2,
        'absence has no event: a request would follow the debounce'
      )
      expect(calls).toBe(0)
      expect(screen.queryByText('Searching…')).not.toBeInTheDocument()
    })
  })

  describe('a failed search', () => {
    it('offers Try again in place of "No results.", and the row keeps the palette open', async () => {
      let calls = 0
      server.use(
        http.get('/api/v1/palette-test/tenants', () => {
          calls += 1
          return calls === 1 ? fail('Boom', 500) : ok(listPage([ACME]))
        })
      )
      const user = userEvent.setup()
      renderPalette()
      await openWithShortcut(user)
      await user.keyboard('acme')

      const retry = await screen.findByRole('option', { name: 'Search failed. Try again' })
      expect(screen.queryByText('No results.')).not.toBeInTheDocument()
      await user.click(retry)

      expect(await screen.findByRole('option', { name: /Acme Corp/ })).toBeInTheDocument()
      expect(useCommandPaletteStore.getState().open).toBe(true)
      expect(calls).toBe(2)
    })

    it('keeps the other search’s rows when one fails', async () => {
      server.use(
        http.get('/api/v1/palette-test/users', () => fail('Boom', 500)),
        http.get('/api/v1/palette-test/tenants', () => ok(listPage([ACME])))
      )
      const user = userEvent.setup()
      renderPalette()
      await openWithShortcut(user)
      await user.keyboard('acme')

      expect(await screen.findByRole('option', { name: 'Search failed. Try again' })).toBeVisible()
      expect(screen.getByRole('option', { name: /Acme Corp/ })).toBeInTheDocument()
    })

    it('does not show the previous term’s failure while the next term waits', async () => {
      let release: (() => void) | undefined
      server.use(
        http.get('/api/v1/palette-test/tenants', async ({ request }) => {
          if (new URL(request.url).searchParams.get('search') === 'o') return fail('Boom', 500)
          // Held, so "Searching…" stays up until the test has looked at it.
          await new Promise<void>((resolve) => {
            release = resolve
          })
          return ok(listPage([]))
        })
      )
      const user = userEvent.setup()
      renderPalette()
      await openWithShortcut(user)
      await user.keyboard('o')
      await screen.findByRole('option', { name: 'Search failed. Try again' })

      try {
        await user.keyboard('v')
        await waitFor(() => expect(release).toBeDefined())
        expect(screen.queryByRole('option', { name: 'Search failed. Try again' })).toBeNull()
        expect(screen.getByText('Searching…')).toBeInTheDocument()
      } finally {
        release?.()
      }
      await waitFor(() => expect(screen.queryByText('Searching…')).not.toBeInTheDocument())
    })
  })

  describe('choosing', () => {
    it('runs an immediate command, closes, and sends only its action', async () => {
      const track = vi.spyOn(analytics, 'track')
      const user = userEvent.setup()
      const router = renderPalette()
      await openWithShortcut(user)
      await user.keyboard('ten')
      await user.click(await screen.findByRole('option', { name: 'Tenants' }))

      await waitFor(() => expect(router.state.location.pathname).toBe('/tenants'))
      expect(useCommandPaletteStore.getState().open).toBe(false)
      expect(track.mock.calls).toEqual([
        ['command_palette_opened'],
        ['command_palette_action_run', { action: 'open_page' }],
      ])
    })

    it.each([
      ['a page', 'Overview', 'open_page'],
      ['a dialog action', 'Open the test dialog', 'create_tenant'],
      ['a copy', 'Copy test ID', 'copy_id'],
      ['a row that keeps the palette open', 'Stay open', 'retry_search'],
    ])(
      'sends exactly { action } for %s, never a label, term or id',
      async (_kind, label, action) => {
        const track = vi.spyOn(analytics, 'track')
        const user = userEvent.setup()
        renderPalette()
        await openWithShortcut(user)
        await user.keyboard(label.slice(0, 4))
        await user.click(await screen.findByRole('option', { name: label }))

        const runs = track.mock.calls.filter(([event]) => event === 'command_palette_action_run')
        expect(runs).toEqual([['command_palette_action_run', { action }]])
        expect(JSON.stringify(track.mock.calls)).not.toContain(label.slice(0, 4))
      }
    )

    it('sends exactly { action } for a found tenant and user, never the term or the id', async () => {
      server.use(
        http.get('/api/v1/palette-test/tenants', () => ok(listPage([ACME]))),
        http.get('/api/v1/palette-test/users', () => ok(listPage([CLEO])))
      )
      const track = vi.spyOn(analytics, 'track')
      const user = userEvent.setup()
      renderPalette()
      await openWithShortcut(user)
      await user.keyboard('acme')
      await user.click(await screen.findByRole('option', { name: /Acme Corp/ }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await pressShortcut(user)
      await user.keyboard('cleo')
      await user.click(await screen.findByRole('option', { name: /cleo@example\.com/ }))

      expect(track.mock.calls.filter(([event]) => event === 'command_palette_action_run')).toEqual([
        ['command_palette_action_run', { action: 'open_tenant' }],
        ['command_palette_action_run', { action: 'open_user' }],
      ])
      const sent = JSON.stringify(track.mock.calls)
      for (const leak of [ACME.id, CLEO.id, CLEO.email, 'acme', 'cleo'])
        expect(sent).not.toContain(leak)
    })

    it('puts a found user’s email and name inside Pii, and a found tenant’s outside', async () => {
      server.use(
        http.get('/api/v1/palette-test/tenants', () => ok(listPage([ACME]))),
        http.get('/api/v1/palette-test/users', () => ok(listPage([CLEO])))
      )
      const user = userEvent.setup()
      renderPalette()
      await openWithShortcut(user)
      await user.keyboard('acme')
      const userRow = await screen.findByRole('option', { name: /cleo@example\.com/ })
      expect(within(userRow).getByText(CLEO.email)).toHaveClass('ph-sensitive')
      expect(within(userRow).getByText(CLEO.name)).toHaveClass('ph-sensitive')
      const tenantRow = screen.getByRole('option', { name: /Acme Corp/ })
      expect(within(tenantRow).getByText(ACME.name)).not.toHaveClass('ph-sensitive')
    })

    it('runs an afterClose command only once the palette has closed, and its dialog has focus', async () => {
      const user = userEvent.setup()
      renderPalette()
      await openWithShortcut(user)
      await user.keyboard('test dialog')
      await user.click(await screen.findByRole('option', { name: 'Open the test dialog' }))

      const dialog = await screen.findByRole('dialog', { name: 'Test dialog' })
      expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()
      await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))
    })

    it('copies inside the gesture, says so, and never shows the id', async () => {
      const user = userEvent.setup()
      renderPalette()
      await openWithShortcut(user)
      const write = vi.spyOn(navigator.clipboard, 'writeText')
      await user.keyboard('copy')
      await user.click(await screen.findByRole('option', { name: 'Copy test ID' }))

      // Nothing is awaited since the click: a deferred copy would not have run yet.
      expect(write).toHaveBeenCalledWith('test-id-1')
      expect(useCommandPaletteStore.getState().open).toBe(false)
      await expect(navigator.clipboard.readText()).resolves.toBe('test-id-1')
    })

    it('keeps the palette open for a stay command', async () => {
      const user = userEvent.setup()
      renderPalette()
      await openWithShortcut(user)
      await user.keyboard('stay')
      await user.click(await screen.findByRole('option', { name: 'Stay open' }))
      expect(useCommandPaletteStore.getState().open).toBe(true)
    })

    it('marks a disabled row and runs nothing for it', async () => {
      const track = vi.spyOn(analytics, 'track')
      const user = userEvent.setup()
      const router = renderPalette()
      await openWithShortcut(user)
      await user.keyboard('blocked')
      const row = await screen.findByRole('option', { name: /^Blocked thing/ })
      expect(row).toHaveTextContent('Blocked thing, Suspended')
      expect(row).toHaveAttribute('aria-disabled', 'true')
      await user.keyboard('{Enter}')
      expect(router.state.location.pathname).toBe('/overview')
      expect(track.mock.calls.filter(([event]) => event === 'command_palette_action_run')).toEqual(
        []
      )
    })
  })

  describe('This page', () => {
    it('lists a mounted source’s commands, and drops them after a route change', async () => {
      const user = userEvent.setup()
      const router = renderPalette({ path: `/tenants/${ACME.id}` })
      await screen.findByRole('heading', { name: '/tenants/$tenantId' })
      const palette = await pressShortcut(user)
      const group = within(palette).getByRole('group', { name: 'This page' })
      expect(within(group).getByRole('option', { name: 'Suspend' })).toBeInTheDocument()
      await user.keyboard('{Escape}')

      await router.navigate({ href: '/overview' })
      await screen.findByRole('heading', { name: '/overview' })
      await pressShortcut(user)
      expect(screen.queryByRole('option', { name: 'Suspend' })).not.toBeInTheDocument()
    })
  })

  describe('accessibility', () => {
    it('has no axe violations with Recent, This page and the failure row showing', async () => {
      server.use(http.get('/api/v1/palette-test/tenants', () => fail('Boom', 500)))
      recordRecent(testUser.id, { kind: 'user', id: CLEO.id, label: CLEO.email })
      const user = userEvent.setup()
      renderPalette({ path: `/tenants/${ACME.id}` })
      await screen.findByRole('heading', { name: '/tenants/$tenantId' })
      const palette = await pressShortcut(user)
      expect(palette).toHaveAccessibleDescription('Search the test app’s pages, tenants and users.')
      expect(within(palette).getByRole('group', { name: 'Recent' })).toBeInTheDocument()
      expect(within(palette).getByRole('group', { name: 'This page' })).toBeInTheDocument()
      await user.keyboard('c')
      expect(
        await within(palette).findByRole('option', { name: 'Search failed. Try again' })
      ).toBeVisible()

      // Contrast needs layout, which jsdom lacks; `pnpm test:contrast` grades it in a browser.
      const results = await axeCore.run(palette, {
        rules: { 'color-contrast': { enabled: false } },
      })
      expect(results.violations).toEqual([])
      expect(screen.getByRole('combobox')).toHaveAccessibleDescription(
        'Use the arrow keys to move and Enter to choose the highlighted item.'
      )
    })
  })

  describe('row and group keys', () => {
    it('lists a tenant and a user recent that share an id, with no duplicate-key warning', async () => {
      const error = vi.spyOn(console, 'error')
      recordRecent(testUser.id, { kind: 'user', id: ACME.id, label: CLEO.email })
      recordRecent(testUser.id, { kind: 'tenant', id: ACME.id, label: ACME.name, detail: 'acme' })
      const user = userEvent.setup()
      renderPalette()
      const palette = await openWithShortcut(user)
      const rows = within(within(palette).getByRole('group', { name: 'Recent' })).getAllByRole(
        'option'
      )
      expect(rows).toHaveLength(2)
      expect(error.mock.calls.flat().join(' ')).not.toContain('same key')
    })

    it('lists a static and a searched group that share an id, with no duplicate-key warning', async () => {
      const error = vi.spyOn(console, 'error')
      server.use(http.get('/api/v1/palette-test/tenants', () => ok(listPage([ACME]))))
      const user = userEvent.setup()
      renderPalette()
      await openWithShortcut(user)
      await user.keyboard('acme')
      expect(await screen.findByRole('option', { name: /Acme Corp/ })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Switch to Acme' })).toBeInTheDocument()
      expect(screen.getAllByRole('group', { name: /Tenants|Switch tenant/ })).toHaveLength(2)
      expect(error.mock.calls.flat().join(' ')).not.toContain('same key')
    })
  })

  describe('Recent', () => {
    it('lists the signed-in user’s recents first, a user’s inside Pii', async () => {
      recordRecent(testUser.id, { kind: 'user', id: CLEO.id, label: CLEO.email })
      recordRecent(testUser.id, { kind: 'tenant', id: ACME.id, label: ACME.name, detail: 'acme' })
      const user = userEvent.setup()
      renderPalette()
      const palette = await openWithShortcut(user)
      const group = within(palette).getByRole('group', { name: 'Recent' })
      const rows = within(group).getAllByRole('option')
      expect(rows.map((row) => row.textContent)).toEqual(['Acme Corp, acme', 'cleo@example.com'])
      expect(within(rows[1]!).getByText(CLEO.email)).toHaveClass('ph-sensitive')
      const headings = [...palette.querySelectorAll('[data-slot="command-group-label"]')]
      expect(headings[0]?.textContent).toBe('Recent')
    })
  })
})
