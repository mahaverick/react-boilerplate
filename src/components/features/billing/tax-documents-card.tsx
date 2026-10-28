import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { TaxDocumentButton } from '@/components/features/billing/tax-document-button'
import { LoadError } from '@/components/features/load-error'
import { EmptyState } from '@/components/shared/empty-state'
import { CardRowsSkeleton } from '@/components/shared/section-skeleton'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { codeFrom, statusFrom } from '@/lib/api-error'
import { formatBillingDate, formatInr } from '@/lib/billing-format'
import { billingKeys } from '@/queries/billing.queries'
import { taxDocumentsQueryOptions } from '@/queries/tax.queries'
import { TAX_DOCUMENTS_DISABLED } from '@/types/tax.types'

/** The zone every tax document is dated in, as printed on it. */
const DOCUMENT_TIME_ZONE = 'Asia/Kolkata'

/**
 * Billing's "Tax documents" card: every tax invoice and credit note of the
 * workspace, newest first, each a PDF download. Pages are read one cursor at a
 * time as `InvoicesCard` reads them. Dates are in IST, not the tenant's zone.
 * Renders nothing when the API answers 404 `tax_documents_disabled`, and
 * refetches the billing view so the flags catch up. Mount it only for an owner
 * when tax documents are on or exist.
 * @param props - The tenant.
 */
export function TaxDocumentsCard({ slug }: { slug: string }) {
  const queryClient = useQueryClient()
  const documents = useInfiniteQuery({ ...taxDocumentsQueryOptions(slug), retry: false })
  const rows = documents.data?.pages.flatMap((page) => page.items) ?? []
  const failed = documents.isError
  const disabled =
    failed &&
    statusFrom(documents.error) === 404 &&
    codeFrom(documents.error) === TAX_DOCUMENTS_DISABLED

  useEffect(() => {
    if (disabled) {
      void queryClient.invalidateQueries({ queryKey: billingKeys.billing(slug), exact: true })
    }
  }, [disabled, queryClient, slug])

  if (disabled) return null

  let body
  if (documents.data === undefined && !failed) body = <CardRowsSkeleton rows={3} />
  else if (rows.length === 0 && !failed) {
    body = (
      <EmptyState
        size="compact"
        title="No tax documents yet."
        description="We issue a tax invoice for each charge paid from the Goods and Services Tax (GST) start date."
      />
    )
  } else {
    body = (
      <>
        {rows.length > 0 && (
          <Table aria-label="Tax documents">
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Reduces</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell>
                    <TaxDocumentButton
                      slug={slug}
                      document={doc}
                      label={`${doc.type === 'credit_note' ? 'Credit note' : 'Tax invoice'} ${doc.number}`}
                    />
                  </TableCell>
                  <TableCell>{formatBillingDate(doc.issuedAt, DOCUMENT_TIME_ZONE)}</TableCell>
                  <TableCell>{formatInr(doc.amounts.totalMinor)}</TableCell>
                  <TableCell>{doc.invoice?.number}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {failed && (
          <LoadError
            message="Tax documents didn’t load. Try again."
            onRetry={() =>
              void (documents.isFetchNextPageError
                ? documents.fetchNextPage()
                : documents.refetch())
            }
          />
        )}
        {documents.hasNextPage && !documents.isFetchNextPageError && (
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={documents.isFetchingNextPage}
              onClick={() => void documents.fetchNextPage()}
            >
              Show more
            </Button>
          </div>
        )}
        {documents.isFetchingNextPage && <CardRowsSkeleton rows={1} />}
      </>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Tax documents</h2>
        </CardTitle>
        <CardDescription>
          Every tax invoice and credit note for this workspace, newest first. Dates are in India
          Standard Time (IST), as printed on each document.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">{body}</CardContent>
    </Card>
  )
}
