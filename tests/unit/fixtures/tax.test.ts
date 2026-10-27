import { describe, expect, it } from 'vite-plus/test'
import { testBilling } from '@/tests/fixtures/billing'
import { TAX_DOCUMENTS, TAX_INVOICES, testInvoice, testTaxDetails } from '@/tests/fixtures/tax'

describe('tax fixtures', () => {
  it('testInvoice has no tax document, no credit notes and no taxHeld key', () => {
    const invoice = testInvoice()
    expect(invoice.taxDocument).toBeNull()
    expect(invoice.creditNotes).toEqual([])
    expect(invoice.taxStatus).toBe('not_applicable')
    expect('taxHeld' in invoice).toBe(false)
  })

  it('testBilling has both tax flags off', () => {
    const billing = testBilling()
    expect(billing.taxDocumentsEnabled).toBe(false)
    expect(billing.hasTaxDocuments).toBe(false)
  })

  it('testTaxDetails is a Karnataka buyer at version 3', () => {
    expect(testTaxDetails()).toMatchObject({
      gstin: '29ABCDE1234F1ZW',
      state: { code: '29', name: 'Karnataka' },
      version: 3,
    })
  })

  it('TAX_INVOICES covers pending, issued, credited and held, newest first', () => {
    expect(TAX_INVOICES.map((i) => i.taxStatus)).toEqual(['pending', 'issued', 'issued', 'held'])
    expect(TAX_INVOICES[1]!.creditNotes).toEqual([])
    expect(TAX_INVOICES[2]!.creditNotes.map((n) => n.number)).toEqual([
      'CN/26-27/00001',
      'CN/26-27/00002',
    ])
  })

  it('the newest tax document is a credit note that no invoice row links', () => {
    expect(TAX_DOCUMENTS[0]!.number).toBe('CN/26-27/00003')
    const linked = TAX_INVOICES.flatMap((i) => i.creditNotes.map((n) => n.id))
    expect(linked).not.toContain(TAX_DOCUMENTS[0]!.id)
  })

  it('every document adds up to its total', () => {
    for (const { amounts: a } of TAX_DOCUMENTS) {
      expect(a.taxableMinor + a.cgstMinor + a.sgstMinor + a.igstMinor).toBe(a.totalMinor)
    }
  })
})
