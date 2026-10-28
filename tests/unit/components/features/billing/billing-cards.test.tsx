import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { InvoicesCard } from '@/components/features/billing/invoices-card'
import { UpgradeRequestsCard } from '@/components/features/billing/upgrade-requests-card'
import { resetSessionForTests } from '@/http/session'
import { useAuthStore } from '@/states/auth.store'
import { testUpgradeRequest } from '@/tests/fixtures/billing'
import { listPage } from '@/tests/fixtures/list-page'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const BASE = '/api/v1/tenants/acme'

/** Renders `ui` with a fresh query client that never retries. */
function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  resetSessionForTests()
  useAuthStore.setState({
    accessToken: 'access-token',
    user: testUser,
    isAuthenticated: true,
    isBootstrapped: true,
  })
})

describe('InvoicesCard', () => {
  it('offers a retry when the invoices fail to load, and shows them after it', async () => {
    let calls = 0
    server.use(
      http.get(`${BASE}/billing/invoices`, () => {
        calls += 1
        return calls === 1
          ? fail('Our payment provider did not answer. Try again in 30 seconds.', 503)
          : ok(
              listPage([
                {
                  id: 'inv_1',
                  amountMinor: 999_000,
                  currency: 'INR',
                  status: 'paid',
                  issuedAt: '2026-11-02T18:30:00.000Z',
                  paidAt: null,
                  url: null,
                },
              ]),
              'Invoices retrieved.'
            )
      })
    )
    const user = userEvent.setup()
    renderWithClient(<InvoicesCard slug="acme" timeZone="Asia/Kolkata" showTax={false} />)
    expect(await screen.findByText('Invoices didn’t load. Try again.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('table', { name: 'Invoices' })).toHaveTextContent(
      '3 November 2026₹9,990Paid'
    )
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('links only an https invoice URL', async () => {
    const urls = [
      'https://rzp.io/i/abc',
      'http://rzp.io/i/plain',
      'javascript:alert(1)',
      'not a url',
      null,
    ]
    server.use(
      http.get(`${BASE}/billing/invoices`, () =>
        ok(
          listPage(
            urls.map((url, index) => ({
              id: `inv_${String(index)}`,
              amountMinor: 99_900,
              currency: 'INR' as const,
              status: 'paid' as const,
              issuedAt: `2026-0${String(index + 1)}-02T09:00:00.000Z`,
              paidAt: null,
              url,
            }))
          ),
          'Invoices retrieved.'
        )
      )
    )
    renderWithClient(<InvoicesCard slug="acme" timeZone="UTC" showTax={false} />)
    await screen.findByRole('table', { name: 'Invoices' })
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', 'https://rzp.io/i/abc')
  })
})

describe('UpgradeRequestsCard', () => {
  it('shows its card with a retry when the requests fail to load', async () => {
    server.use(http.get(`${BASE}/upgrade-requests`, () => fail('Server error.', 500)))
    renderWithClient(<UpgradeRequestsCard slug="acme" timeZone="UTC" />)
    expect(await screen.findByText('Upgrade requests didn’t load. Try again.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Upgrade requests' })).toBeInTheDocument()
  })

  it('dates each request in the tenant’s zone', async () => {
    server.use(
      http.get(`${BASE}/upgrade-requests`, () =>
        ok([testUpgradeRequest({ createdAt: '2026-10-20T19:00:00.000Z' })], 'Retrieved.')
      )
    )
    renderWithClient(<UpgradeRequestsCard slug="acme" timeZone="Asia/Kolkata" />)
    await waitFor(() =>
      expect(screen.getByRole('listitem')).toHaveTextContent(
        'Grace Hopper asked to upgrade on 21 October 2026.'
      )
    )
  })
})
