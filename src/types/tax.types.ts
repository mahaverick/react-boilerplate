/**
 * The GST tax document contract (the tax-document and tax-details shapes),
 * owner shapes only, as the server sends them. Money is integer paise;
 * timestamps are ISO 8601 UTC strings.
 */

/** What a tax document is. */
export type TaxDocumentType = 'invoice' | 'credit_note'

/** Intra-state supply charges CGST 9% + SGST 9%; inter-state charges IGST 18%. */
export type SupplyKind = 'intra' | 'inter'

/** Where a paid invoice row stands on its tax invoice. */
export type TaxStatus = 'issued' | 'held' | 'pending' | 'not_applicable'

/** A state or territory. `code` is two digits, such as `'29'`. */
export interface GstState {
  code: string
  name: string
}

/** `GET /tenants/:slug/billing/tax-details`: the buyer details printed on documents. */
export interface TaxDetails {
  /** 15 characters, upper case. `null` is an unregistered buyer. */
  gstin: string | null
  legalName: string
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  /** Six digits, the first not 0. */
  pincode: string | null
  /** The billing-address state. Every saved row has one. */
  state: GstState
  isSez: boolean
  /** Send it back on PATCH. */
  version: number
  updatedAt: string
}

/** A link from one tax document or invoice row to a document. */
export interface TaxDocumentRef {
  id: string
  number: string
}

/** A document's amounts in paise. `totalMinor` = taxable + cgst + sgst + igst. */
export interface TaxAmounts {
  /** GST-inclusive. */
  totalMinor: number
  taxableMinor: number
  /** 0 for inter-state. */
  cgstMinor: number
  /** 0 for inter-state. */
  sgstMinor: number
  /** 0 for intra-state. */
  igstMinor: number
  ratePercent: 18
}

/** One row of `GET /tenants/:slug/billing/tax-documents`. */
export interface TaxDocumentView {
  id: string
  type: TaxDocumentType
  /** `INV/26-27/00001` or `CN/26-27/00001`; at most 16 characters. */
  number: string
  /** `26-27`. */
  financialYear: string
  issuedAt: string
  amounts: TaxAmounts
  supply: SupplyKind
  placeOfSupply: GstState
  /** The snapshot's GSTIN, not today's tax details. */
  buyerGstin: string | null
  /** A credit note: the invoice it reduces. An invoice: `null`. */
  invoice: TaxDocumentRef | null
  /** An invoice: its credit notes, oldest first. A credit note: `[]`. */
  creditNotes: TaxDocumentRef[]
  /** An invoice: the total credited so far. A credit note: 0. */
  creditedMinor: number
  /** A credit note issued after the s.34(2) deadline. `false` for invoices. */
  noTaxReduction: boolean
  /** A credit note's reason. `null` for invoices. */
  reason: string | null
  /** The provider's payment id. */
  paymentId: string | null
  /** An automatic credit note's refund id. */
  refundId: string | null
}

/** The body of `PATCH /billing/tax-details`: `version` plus only the fields that changed. */
export interface TaxDetailsPatch {
  /** `null` to create (no row yet); the current version to update. */
  version: number | null
  gstin?: string | null
  legalName?: string
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  pincode?: string | null
  /** Never `null`. */
  stateCode?: string
  isSez?: boolean
}

/** `code` on the 404 when registration is off and the workspace has no documents (any route), or registration is off (a write). */
export const TAX_DOCUMENTS_DISABLED = 'tax_documents_disabled'

/** `code` on the 404 when the document id is unknown or belongs to another workspace. */
export const TAX_DOCUMENT_NOT_FOUND = 'tax_document_not_found'

/** `code` on the 409 for a tax details PATCH with a stale `version`. */
export const TAX_DETAILS_VERSION_CONFLICT = 'TAX_DETAILS_VERSION_CONFLICT'
