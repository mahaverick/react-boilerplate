import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '@/components/layouts/app-shell'
import { usePasskeySetupStore } from '@/states/passkey-setup.store'

// The lazy setup screen's chunk fails to load, as after a deploy removed it.
vi.mock('@/components/features/passkeys/passkey-setup-screen', () => {
  throw new Error('Failed to fetch dynamically imported module')
})
vi.mock('@/components/layouts/app-layout', () => ({ AppLayout: () => <p>layout</p> }))

describe('AppShell when the setup screen chunk fails to load', () => {
  afterEach(() => {
    usePasskeySetupStore.setState({ required: false, message: null })
    vi.restoreAllMocks()
  })

  it('says so, with a Reload button, instead of taking out the route', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    usePasskeySetupStore.setState({ required: true, message: 'Create a passkey.' })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppShell />
      </QueryClientProvider>
    )

    expect(
      await screen.findByText('We couldn’t load this page. Reload to try again.')
    ).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})
