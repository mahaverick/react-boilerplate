import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { SecuritySection } from '@/components/features/profile/security-section'
import { ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

// The lazy Passkeys chunk fails to load, as after a deploy removed it.
vi.mock('@/components/features/profile/passkeys-section', () => {
  throw new Error('Failed to fetch dynamically imported module')
})

describe('SecuritySection when the Passkeys chunk fails to load', () => {
  it('says Passkeys did not load and keeps the rest of the page', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    server.use(
      http.get('/api/v1/auth/providers', () => ok({ providers: [] }, 'Auth providers retrieved.'))
    )
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SecuritySection />
      </QueryClientProvider>
    )

    // React logs the failed chunk once it has thrown; only then is the page's fate known.
    await waitFor(() => expect(logged).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: /sign out other/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Security' })).toBeInTheDocument()
    expect(
      screen.getByText('Passkeys didn’t load. Reload the page to try again.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Passkeys' })).not.toBeInTheDocument()
  })
})
