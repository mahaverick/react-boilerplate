import { TaxDocumentButton } from '@/components/features/billing/tax-document-button'
import type { InvoiceView } from '@/types/billing.types'

/**
 * An invoice row's tax documents: its tax invoice, then each credit note
 * oldest first, or a line saying why there is none yet. Document numbers are
 * not personal data.
 * @param props - The tenant and the invoice row.
 */
export function TaxDocumentLinks({ slug, invoice }: { slug: string; invoice: InvoiceView }) {
  return (
    <div className="grid justify-items-start gap-1">
      {invoice.taxDocument !== null && (
        <TaxDocumentButton
          slug={slug}
          document={invoice.taxDocument}
          label={`Tax invoice ${invoice.taxDocument.number}`}
        />
      )}
      {invoice.creditNotes.map((note) => (
        <TaxDocumentButton
          key={note.id}
          slug={slug}
          document={note}
          label={`Credit note ${note.number}`}
        />
      ))}
      {invoice.taxStatus === 'held' && (
        <p className="text-sm whitespace-normal text-muted-foreground">
          Tax invoice held. We issue invoices for Special Economic Zone units by hand.
        </p>
      )}
      {invoice.taxStatus === 'pending' && (
        <p className="text-sm whitespace-normal text-muted-foreground">Tax invoice on its way</p>
      )}
    </div>
  )
}
