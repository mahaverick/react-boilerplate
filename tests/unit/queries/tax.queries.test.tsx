import { QueryClient, QueryClientProvider, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { resetSessionForTests } from '@/http/session'
import { track } from '@/observability/telemetry'
import { invoicesQueryOptions, tenantBillingQueryOptions } from '@/queries/billing.queries'
import {
  downloadTaxDocument,
  taxDetailsQueryOptions,
  taxDocumentsQueryOptions,
  taxKeys,
  useSaveTaxDetails,
} from '@/queries/tax.queries'
import { useAuthStore } from '@/states/auth.store'
import { listPage } from '@/tests/fixtures/list-page'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import {
  TAX_DETAILS_VERSION_CONFLICT,
  TAX_DOCUMENTS_DISABLED,
  type TaxDetails,
  type TaxDocumentView,
} from '@/types/tax.types'

vi.mock('@/observability/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/observability/telemetry')>()),
  track: vi.fn(),
}))

const DETAILS: TaxDetails = {
  gstin: '29AABCE1234F1Z1',
  legalName: 'Acme Pvt Ltd',
  addressLine1: '1 MG Road',
  addressLine2: null,
  city: 'Bengaluru',
  pincode: '560001',
  state: { code: '29', name: 'Karnataka' },
  isSez: false,
  version: 3,
  updatedAt: '2026-10-27T00:00:00.000Z',
}

const DOC = {
  id: 'doc_1',
  type: 'invoice',
  number: 'INV/26-27/00001',
} as TaxDocumentView

let client: QueryClient

/** Provides the per-test `client` to the hook under test. */
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  resetSessionForTests()
  vi.mocked(track).mockReset()
  useAuthStore.setState({
    accessToken: 'access-token',
    user: testUser,
    isAuthenticated: true,
    isBootstrapped: true,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('taxKeys', () => {
  it('sit under the billing key', () => {
    expect(taxKeys.details('acme')).toEqual(['tenants', 'acme', 'billing', 'tax-details'])
    expect(taxKeys.documents('acme')).toEqual(['tenants', 'acme', 'billing', 'tax-documents'])
  })
})

describe('taxDetailsQueryOptions', () => {
  it('asks nothing while disabled', async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/tenants/acme/billing/tax-details', () => {
        calls += 1
        return ok(DETAILS, 'Tax details retrieved.')
      })
    )
    const { result } = renderHook(
      () => useQuery(taxDetailsQueryOptions('acme', { enabled: false })),
      { wrapper }
    )
    expect(result.current.fetchStatus).toBe('idle')
    await settle(20, 'a disabled query has no event to wait on')
    expect(calls).toBe(0)
  })

  it('reads the details, and resolves null when none are saved', async () => {
    server.use(
      http.get('/api/v1/tenants/acme/billing/tax-details', () =>
        ok(DETAILS, 'Tax details retrieved.')
      )
    )
    const saved = renderHook(() => useQuery(taxDetailsQueryOptions('acme', { enabled: true })), {
      wrapper,
    })
    await waitFor(() => expect(saved.result.current.data).toEqual(DETAILS))
    saved.unmount()

    client.clear()
    server.use(
      http.get('/api/v1/tenants/acme/billing/tax-details', () => ok(null, 'Tax details retrieved.'))
    )
    const none = renderHook(() => useQuery(taxDetailsQueryOptions('acme', { enabled: true })), {
      wrapper,
    })
    await waitFor(() => expect(none.result.current.isSuccess).toBe(true))
    expect(none.result.current.data).toBeNull()
  })

  it('rejects on a 404 tax_documents_disabled', async () => {
    server.use(
      http.get('/api/v1/tenants/acme/billing/tax-details', () =>
        fail('Not found.', 404, TAX_DOCUMENTS_DISABLED)
      )
    )
    const { result } = renderHook(
      () => useQuery(taxDetailsQueryOptions('acme', { enabled: true })),
      { wrapper }
    )
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

describe('taxDocumentsQueryOptions', () => {
  it('requests the next page with the answered nextCursor', async () => {
    const cursors: (string | null)[] = []
    server.use(
      http.get('/api/v1/tenants/acme/billing/tax-documents', ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        cursors.push(cursor)
        return ok(
          cursor === null ? listPage([DOC], { hasNext: true, nextCursor: 'c2' }) : listPage([]),
          'Tax documents retrieved.'
        )
      })
    )
    const { result } = renderHook(() => useInfiniteQuery(taxDocumentsQueryOptions('acme')), {
      wrapper,
    })
    await waitFor(() => expect(result.current.data?.pages[0]?.items).toEqual([DOC]))
    expect(result.current.hasNextPage).toBe(true)
    await act(() => result.current.fetchNextPage())
    await waitFor(() => expect(result.current.hasNextPage).toBe(false))
    expect(cursors).toEqual([null, 'c2'])
  })
})

describe('useSaveTaxDetails', () => {
  it('sends the patch as given and caches the answer', async () => {
    const bodies: unknown[] = []
    server.use(
      http.patch('/api/v1/tenants/acme/billing/tax-details', async ({ request }) => {
        bodies.push(await request.json())
        return ok({ ...DETAILS, city: 'Mysuru', version: 4 }, 'Tax details saved.')
      })
    )
    const { result } = renderHook(() => useSaveTaxDetails('acme'), { wrapper })
    await act(() => result.current.mutateAsync({ version: 3, city: 'Mysuru' }))
    expect(bodies).toEqual([{ version: 3, city: 'Mysuru' }])
    expect(client.getQueryData(taxKeys.details('acme'))).toEqual({
      ...DETAILS,
      city: 'Mysuru',
      version: 4,
    })
  })

  it('sends version null with every field on a create', async () => {
    const create = {
      version: null,
      gstin: null,
      legalName: 'Acme Pvt Ltd',
      addressLine1: '1 MG Road',
      addressLine2: null,
      city: 'Bengaluru',
      pincode: '560001',
      stateCode: '29',
      isSez: false,
    }
    const bodies: unknown[] = []
    server.use(
      http.patch('/api/v1/tenants/acme/billing/tax-details', async ({ request }) => {
        bodies.push(await request.json())
        return ok({ ...DETAILS, gstin: null, version: 1 }, 'Tax details saved.')
      })
    )
    const { result } = renderHook(() => useSaveTaxDetails('acme'), { wrapper })
    await act(() => result.current.mutateAsync(create))
    expect(bodies).toEqual([create])
  })

  it('refetches the details after a 409 version conflict', async () => {
    let reads = 0
    server.use(
      http.get('/api/v1/tenants/acme/billing/tax-details', () => {
        reads += 1
        return ok(DETAILS, 'Tax details retrieved.')
      }),
      http.patch('/api/v1/tenants/acme/billing/tax-details', () =>
        fail('Changed elsewhere.', 409, TAX_DETAILS_VERSION_CONFLICT)
      )
    )
    const details = renderHook(() => useQuery(taxDetailsQueryOptions('acme', { enabled: true })), {
      wrapper,
    })
    await waitFor(() => expect(reads).toBe(1))
    const { result } = renderHook(() => useSaveTaxDetails('acme'), { wrapper })
    await act(async () => {
      await expect(result.current.mutateAsync({ version: 2, city: 'Mysuru' })).rejects.toThrow()
    })
    await waitFor(() => expect(reads).toBe(2))
    details.unmount()
  })

  it('refetches the billing view, not the details or invoices, after a 404 tax_documents_disabled', async () => {
    const reads = { billing: 0, details: 0, invoices: 0 }
    server.use(
      http.get('/api/v1/tenants/acme/billing', () => {
        reads.billing += 1
        return ok({}, 'Billing retrieved.')
      }),
      http.get('/api/v1/tenants/acme/billing/tax-details', () => {
        reads.details += 1
        return ok(DETAILS, 'Tax details retrieved.')
      }),
      http.get('/api/v1/tenants/acme/billing/invoices', () => {
        reads.invoices += 1
        return ok(listPage([]), 'Invoices retrieved.')
      }),
      http.patch('/api/v1/tenants/acme/billing/tax-details', () =>
        fail('Not found.', 404, TAX_DOCUMENTS_DISABLED)
      )
    )
    const billing = renderHook(() => useQuery(tenantBillingQueryOptions('acme')), { wrapper })
    const details = renderHook(() => useQuery(taxDetailsQueryOptions('acme', { enabled: true })), {
      wrapper,
    })
    const invoices = renderHook(() => useInfiniteQuery(invoicesQueryOptions('acme')), { wrapper })
    await waitFor(() => expect(reads).toEqual({ billing: 1, details: 1, invoices: 1 }))
    const { result } = renderHook(() => useSaveTaxDetails('acme'), { wrapper })
    await act(async () => {
      await expect(result.current.mutateAsync({ version: 3, city: 'Mysuru' })).rejects.toThrow()
    })
    await waitFor(() => expect(reads.billing).toBe(2))
    await settle(50, 'a refetch that must not happen has no event to wait on')
    expect(reads).toEqual({ billing: 2, details: 1, invoices: 1 })
    billing.unmount()
    details.unmount()
    invoices.unmount()
  })
})

describe('downloadTaxDocument', () => {
  it('requests the pdf for the document and tracks nothing', async () => {
    if (!('createObjectURL' in URL)) {
      Object.defineProperty(URL, 'createObjectURL', {
        value: () => '',
        configurable: true,
        writable: true,
      })
    }
    if (!('revokeObjectURL' in URL)) {
      Object.defineProperty(URL, 'revokeObjectURL', {
        value: () => undefined,
        configurable: true,
        writable: true,
      })
    }
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:probe')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicked.push(this)
    })
    const urls: string[] = []
    server.use(
      http.get('/api/v1/tenants/acme/billing/tax-documents/doc_1/pdf', ({ request }) => {
        urls.push(new URL(request.url).pathname)
        return new Response('%PDF-1.4', { headers: { 'content-type': 'application/pdf' } })
      })
    )
    await downloadTaxDocument('acme', DOC)
    expect(urls).toEqual(['/api/v1/tenants/acme/billing/tax-documents/doc_1/pdf'])
    expect(clicked[0]?.download).toBe('INV-26-27-00001.pdf')
    expect(track).toHaveBeenCalledTimes(0)
  })
})
