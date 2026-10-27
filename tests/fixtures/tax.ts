import type { InvoiceView } from '@/types/billing.types'
import type { TaxDetails, TaxDocumentView } from '@/types/tax.types'

const KARNATAKA = { code: '29', name: 'Karnataka' }

/**
 * `GET /tenants/:slug/billing/tax-details` for a registered Karnataka buyer.
 * @param overrides - Fields to replace.
 * @returns The tax details.
 */
export function testTaxDetails(overrides: Partial<TaxDetails> = {}): TaxDetails {
  return {
    gstin: '29ABCDE1234F1ZW',
    legalName: 'Acme Traders Private Limited',
    addressLine1: '12 MG Road',
    addressLine2: null,
    city: 'Bengaluru',
    pincode: '560001',
    state: KARNATAKA,
    isSez: false,
    version: 3,
    updatedAt: '2026-10-20T09:00:00.000Z',
    ...overrides,
  }
}

/**
 * One row of `GET /tenants/:slug/billing/invoices` with no tax document and
 * registration off.
 * @param overrides - Fields to replace.
 * @returns The row.
 */
export function testInvoice(overrides: Partial<InvoiceView> = {}): InvoiceView {
  return {
    id: 'inv_1',
    amountMinor: 99_900,
    currency: 'INR',
    status: 'paid',
    issuedAt: '2026-10-20T09:00:00.000Z',
    paidAt: '2026-10-20T09:01:00.000Z',
    url: null,
    taxDocument: null,
    creditNotes: [],
    taxStatus: 'not_applicable',
    ...overrides,
  }
}

/** Four paid invoice rows, newest first: pending, issued, issued with two credit notes, held. */
export const TAX_INVOICES: InvoiceView[] = [
  testInvoice({
    id: 'inv_4',
    issuedAt: '2026-10-27T09:00:00.000Z',
    paidAt: '2026-10-27T09:01:00.000Z',
    taxStatus: 'pending',
  }),
  testInvoice({
    id: 'inv_3',
    issuedAt: '2026-09-27T09:00:00.000Z',
    paidAt: '2026-09-27T09:01:00.000Z',
    taxDocument: { id: 'taxdoc_inv_3', number: 'INV/26-27/00003' },
    taxStatus: 'issued',
  }),
  testInvoice({
    id: 'inv_2',
    issuedAt: '2026-08-27T09:00:00.000Z',
    paidAt: '2026-08-27T09:01:00.000Z',
    taxDocument: { id: 'taxdoc_inv_2', number: 'INV/26-27/00002' },
    creditNotes: [
      { id: 'taxdoc_cn_1', number: 'CN/26-27/00001' },
      { id: 'taxdoc_cn_2', number: 'CN/26-27/00002' },
    ],
    taxStatus: 'issued',
  }),
  testInvoice({
    id: 'inv_1',
    issuedAt: '2026-07-27T09:00:00.000Z',
    paidAt: '2026-07-27T09:01:00.000Z',
    taxStatus: 'held',
  }),
]

/** An intra-state ₹999 document's amounts (GC§6): taxable 84661, CGST 7619, SGST 7620. */
const FULL_AMOUNTS = {
  totalMinor: 99_900,
  taxableMinor: 84_661,
  cgstMinor: 7_619,
  sgstMinor: 7_620,
  igstMinor: 0,
  ratePercent: 18,
} as const

/**
 * A tax document with intra-state Karnataka defaults.
 * @param overrides - Fields to replace.
 * @returns The document.
 */
function doc(overrides: Partial<TaxDocumentView> & Pick<TaxDocumentView, 'id' | 'number'>) {
  const isCreditNote = overrides.number.startsWith('CN/')
  return {
    type: isCreditNote ? 'credit_note' : 'invoice',
    financialYear: '26-27',
    issuedAt: '2026-10-27T09:00:00.000Z',
    amounts: FULL_AMOUNTS,
    supply: 'intra',
    placeOfSupply: KARNATAKA,
    buyerGstin: '29ABCDE1234F1ZW',
    invoice: null,
    creditNotes: [],
    creditedMinor: 0,
    noTaxReduction: false,
    reason: null,
    paymentId: null,
    refundId: null,
    ...overrides,
  } satisfies TaxDocumentView
}

/**
 * `GET /billing/tax-documents`, newest first. The first note credits a
 * refunded duplicate charge's invoice, which has no row in `TAX_INVOICES`.
 * The two notes on `INV/26-27/00002` are GC§6's refunds of 50000 and 49900.
 */
export const TAX_DOCUMENTS: TaxDocumentView[] = [
  doc({
    id: 'taxdoc_cn_3',
    number: 'CN/26-27/00003',
    issuedAt: '2026-10-27T10:00:00.000Z',
    invoice: { id: 'taxdoc_inv_4', number: 'INV/26-27/00004' },
    reason: 'Duplicate payment refunded',
    paymentId: 'pay_dup',
    refundId: 'rfnd_dup',
  }),
  doc({
    id: 'taxdoc_inv_4',
    number: 'INV/26-27/00004',
    issuedAt: '2026-10-27T09:00:00.000Z',
    creditNotes: [{ id: 'taxdoc_cn_3', number: 'CN/26-27/00003' }],
    creditedMinor: 99_900,
    paymentId: 'pay_dup',
  }),
  doc({
    id: 'taxdoc_inv_3',
    number: 'INV/26-27/00003',
    issuedAt: '2026-09-27T09:00:00.000Z',
    paymentId: 'pay_3',
  }),
  doc({
    id: 'taxdoc_cn_2',
    number: 'CN/26-27/00002',
    issuedAt: '2026-08-29T09:00:00.000Z',
    amounts: {
      totalMinor: 49_900,
      taxableMinor: 42_288,
      cgstMinor: 3_806,
      sgstMinor: 3_806,
      igstMinor: 0,
      ratePercent: 18,
    },
    invoice: { id: 'taxdoc_inv_2', number: 'INV/26-27/00002' },
    reason: 'Refund',
    paymentId: 'pay_2',
    refundId: 'rfnd_2',
  }),
  doc({
    id: 'taxdoc_cn_1',
    number: 'CN/26-27/00001',
    issuedAt: '2026-08-28T09:00:00.000Z',
    amounts: {
      totalMinor: 50_000,
      taxableMinor: 42_373,
      cgstMinor: 3_813,
      sgstMinor: 3_814,
      igstMinor: 0,
      ratePercent: 18,
    },
    invoice: { id: 'taxdoc_inv_2', number: 'INV/26-27/00002' },
    reason: 'Refund',
    paymentId: 'pay_2',
    refundId: 'rfnd_1',
  }),
  doc({
    id: 'taxdoc_inv_2',
    number: 'INV/26-27/00002',
    issuedAt: '2026-08-27T09:00:00.000Z',
    creditNotes: [
      { id: 'taxdoc_cn_1', number: 'CN/26-27/00001' },
      { id: 'taxdoc_cn_2', number: 'CN/26-27/00002' },
    ],
    creditedMinor: 99_900,
    paymentId: 'pay_2',
  }),
]
