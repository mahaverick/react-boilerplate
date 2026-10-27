import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { TaxDocumentsCard } from '@/components/features/billing/tax-documents-card'
import { resetSessionForTests } from '@/http/session'
import { billingKeys } from '@/queries/billing.queries'
import { useAuthStore } from '@/states/auth.store'
import { listPage } from '@/tests/fixtures/list-page'
import { TAX_DOCUMENTS } from '@/tests/fixtures/tax'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const BASE = '/api/v1/tenants/acme'
const URL_PATH = `${BASE}/billing/tax-documents`

/** Renders `ui` with a fresh query client that never retries; returns it. */
function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
  return client
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

describe('TaxDocumentsCard', () => {
  it('lists every document and shows the invoice a credit note reduces', async () => {
    server.use(http.get(URL_PATH, () => ok(listPage(TAX_DOCUMENTS), 'Retrieved.')))
    renderWithClient(<TaxDocumentsCard slug="acme" />)
    expect(await screen.findByRole('heading', { level: 2, name: 'Tax documents' })).toBeVisible()
    expect(
      screen.getByText(
        'Every tax invoice and credit note for this workspace, newest first. Dates are in India Standard Time (IST), as printed on each document.'
      )
    ).toBeInTheDocument()
    const note = await screen.findByRole('button', { name: 'Credit note CN/26-27/00003' })
    const row = note.closest('tr')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('INV/26-27/00004')).toBeInTheDocument()
    expect(row).toHaveTextContent('₹999')
  })

  it('dates a document in India Standard Time', async () => {
    server.use(
      http.get(URL_PATH, () =>
        ok(listPage([{ ...TAX_DOCUMENTS[2]!, issuedAt: '2026-10-31T20:00:00.000Z' }]), 'Retrieved.')
      )
    )
    renderWithClient(<TaxDocumentsCard slug="acme" />)
    const button = await screen.findByRole('button', { name: 'Tax invoice INV/26-27/00003' })
    expect(button.closest('tr')).toHaveTextContent('1 November 2026')
  })

  it('loads the next page with Show more and the answered cursor', async () => {
    const cursors: (string | null)[] = []
    server.use(
      http.get(URL_PATH, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        cursors.push(cursor)
        return cursor === null
          ? ok(listPage([TAX_DOCUMENTS[0]!], { hasNext: true, nextCursor: 'c2' }), 'Retrieved.')
          : ok(listPage([TAX_DOCUMENTS[2]!]), 'Retrieved.')
      })
    )
    const user = userEvent.setup()
    renderWithClient(<TaxDocumentsCard slug="acme" />)
    await screen.findByRole('button', { name: 'Credit note CN/26-27/00003' })
    await user.click(screen.getByRole('button', { name: 'Show more' }))
    expect(await screen.findByRole('button', { name: 'Tax invoice INV/26-27/00003' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Credit note CN/26-27/00003' })).toBeVisible()
    expect(cursors).toEqual([null, 'c2'])
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  it('says so when there are no documents', async () => {
    server.use(http.get(URL_PATH, () => ok(listPage([]), 'Retrieved.')))
    renderWithClient(<TaxDocumentsCard slug="acme" />)
    expect(await screen.findByText('No tax documents yet.')).toBeInTheDocument()
    expect(
      screen.getByText('We issue a tax invoice for each charge paid from the GST start date.')
    ).toBeInTheDocument()
  })

  it('renders nothing and refetches billing on a 404 tax_documents_disabled', async () => {
    server.use(http.get(URL_PATH, () => fail('Off.', 404, 'tax_documents_disabled')))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // A cached billing view for the effect's invalidation to mark.
    client.setQueryData(billingKeys.billing('acme'), {})
    const { container } = render(
      <QueryClientProvider client={client}>
        <TaxDocumentsCard slug="acme" />
      </QueryClientProvider>
    )
    await waitFor(() =>
      expect(client.getQueryState(['tenants', 'acme', 'billing', 'tax-documents'])?.status).toBe(
        'error'
      )
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('heading', { name: 'Tax documents' })).toBeNull()
    expect(client.getQueryState(billingKeys.billing('acme'))?.isInvalidated).toBe(true)
  })

  it('offers a retry on any other failure', async () => {
    server.use(http.get(URL_PATH, () => fail('Server error.', 500)))
    renderWithClient(<TaxDocumentsCard slug="acme" />)
    expect(await screen.findByText('Tax documents didn’t load. Try again.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Tax documents' })).toBeInTheDocument()
  })
})
