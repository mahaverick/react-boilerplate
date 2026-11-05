import { documentFilename, downloadFile } from '@/lib/download-file'
import type { TaxDocumentRef } from '@/types/tax.types'

/**
 * Saves a tax document's PDF. Rejects with the axios error; the caller shows
 * the toast.
 * @param slug - The tenant.
 * @param doc - The document to save.
 */
export async function downloadTaxDocument(slug: string, doc: TaxDocumentRef): Promise<void> {
  await downloadFile(
    `/tenants/${slug}/billing/tax-documents/${doc.id}/pdf`,
    documentFilename(doc.number)
  )
}
