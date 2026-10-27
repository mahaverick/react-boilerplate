import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { InvoicesCard } from '@/components/features/billing/invoices-card'
import { resetSessionForTests } from '@/http/session'
import { toast } from '@/lib/toast'
import { useAuthStore } from '@/states/auth.store'
import { listPage } from '@/tests/fixtures/list-page'
import { TAX_INVOICES, testInvoice } from '@/tests/fixtures/tax'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const BASE = '/api/v1/tenants/acme'

/** Renders `ui` with a fresh query client that never retries. */
function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

/** Serves `items` as the invoices page. */
function serveInvoices(items = TAX_INVOICES) {
  server.use(http.get(`${BASE}/billing/invoices`, () => ok(listPage(items), 'Invoices retrieved.')))
}

const defined: string[] = []

beforeEach(() => {
  resetSessionForTests()
  useAuthStore.setState({
    accessToken: 'access-token',
    user: testUser,
    isAuthenticated: true,
    isBootstrapped: true,
  })
  // jsdom ships neither method, so give spyOn something to wrap; afterEach removes what was added.
  for (const name of ['createObjectURL', 'revokeObjectURL']) {
    if (!(name in URL)) {
      Object.defineProperty(URL, name, { value: () => '', configurable: true, writable: true })
      defined.push(name)
    }
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const name of defined.splice(0)) Reflect.deleteProperty(URL, name)
})

describe('tax documents on invoice rows', () => {
  it('lists each document, the held sentence and the pending text', async () => {
    serveInvoices()
    renderWithClient(<InvoicesCard slug="acme" timeZone="UTC" showTax />)
    await screen.findByRole('table', { name: 'Invoices' })
    expect(screen.getByRole('columnheader', { name: 'Tax documents' })).toBeInTheDocument()
    const names = screen
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter((text) => text?.startsWith('Tax invoice') || text?.startsWith('Credit note'))
    expect(names).toEqual([
      'Tax invoice INV/26-27/00003',
      'Tax invoice INV/26-27/00002',
      'Credit note CN/26-27/00001',
      'Credit note CN/26-27/00002',
    ])
    expect(
      screen.getByText(
        'Tax invoice held. We issue invoices for Special Economic Zone units by hand.'
      )
    ).toBeInTheDocument()
    expect(screen.getAllByText('Tax invoice on its way')).toHaveLength(1)
  })

  it('shows no tax text for a row that is not applicable', async () => {
    serveInvoices([testInvoice()])
    renderWithClient(<InvoicesCard slug="acme" timeZone="UTC" showTax />)
    await screen.findByRole('table', { name: 'Invoices' })
    expect(screen.queryByText(/Tax invoice/)).toBeNull()
    expect(screen.queryByText(/Credit note/)).toBeNull()
  })

  it('requests the pdf and disables only the clicked button until it settles', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:probe')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    serveInvoices()
    const paths: string[] = []
    let released = false
    server.use(
      http.get(`${BASE}/billing/tax-documents/:id/pdf`, async ({ request }) => {
        paths.push(new URL(request.url).pathname)
        await vi.waitFor(() => expect(released).toBe(true))
        return new Response('%PDF-1.4', { headers: { 'content-type': 'application/pdf' } })
      })
    )
    const user = userEvent.setup()
    renderWithClient(<InvoicesCard slug="acme" timeZone="UTC" showTax />)
    const note = await screen.findByRole('button', { name: 'Credit note CN/26-27/00002' })
    await user.click(note)
    await waitFor(() => expect(note).toBeDisabled())
    expect(paths).toEqual([`${BASE}/billing/tax-documents/taxdoc_cn_2/pdf`])
    expect(screen.getByRole('button', { name: 'Credit note CN/26-27/00001' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Tax invoice INV/26-27/00003' })).toBeEnabled()
    released = true
    await waitFor(() => expect(note).toBeEnabled())
  })

  it('toasts the server message when the pdf is not found', async () => {
    const error = vi.spyOn(toast, 'error')
    serveInvoices()
    server.use(
      http.get(`${BASE}/billing/tax-documents/:id/pdf`, () =>
        fail('M', 404, 'tax_document_not_found')
      )
    )
    const user = userEvent.setup()
    renderWithClient(<InvoicesCard slug="acme" timeZone="UTC" showTax />)
    await user.click(await screen.findByRole('button', { name: 'Tax invoice INV/26-27/00003' }))
    await waitFor(() => expect(error).toHaveBeenCalledWith('M'))
  })

  it('leaves the table as it was without showTax', async () => {
    serveInvoices()
    renderWithClient(<InvoicesCard slug="acme" timeZone="UTC" showTax={false} />)
    await screen.findByRole('table', { name: 'Invoices' })
    expect(screen.queryByRole('columnheader', { name: 'Tax documents' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Tax invoice|Credit note/ })).toBeNull()
    expect(screen.queryByText(/Tax invoice/)).toBeNull()
  })

  it('still links the Razorpay invoice beside the tax documents', async () => {
    serveInvoices([
      testInvoice({ url: 'https://rzp.io/i/abc', taxStatus: 'pending' }),
      testInvoice({ id: 'inv_2', url: 'http://rzp.io/i/plain' }),
    ])
    renderWithClient(<InvoicesCard slug="acme" timeZone="UTC" showTax />)
    await screen.findByRole('table', { name: 'Invoices' })
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', 'https://rzp.io/i/abc')
  })
})
