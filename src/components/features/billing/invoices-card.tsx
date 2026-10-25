import { useQueries } from '@tanstack/react-query'
import { useState } from 'react'
import { LoadError } from '@/components/features/load-error'
import { EmptyState } from '@/components/shared/empty-state'
import { CardRowsSkeleton } from '@/components/shared/section-skeleton'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatBillingDate, formatInr } from '@/lib/billing-format'
import { invoicesQueryOptions } from '@/queries/billing.queries'
import type { InvoiceView } from '@/types/billing.types'

/** Each invoice status as the table says it. */
const STATUS_LABEL: Record<InvoiceView['status'], string> = {
  issued: 'Issued',
  paid: 'Paid',
  cancelled: 'Cancelled',
  expired: 'Expired',
}

/**
 * Billing's "Invoices" card, for an owner with member access while payments
 * are on: date, amount, status and, where Razorpay gave one, a link that opens
 * the invoice in a new tab. Pages are read one cursor at a time; "Show more"
 * adds the next under the ones shown. Mount it only for that owner: the API
 * refuses everyone else and answers 404 while payments are off.
 */
export function InvoicesCard({ slug, timeZone }: { slug: string; timeZone: string }) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const pages = useQueries({
    queries: cursors.map((cursor) => ({ ...invoicesQueryOptions(slug, cursor), retry: false })),
  })
  const first = pages[0]
  const last = pages.at(-1)
  const rows = pages.flatMap((page) => page.data?.items ?? [])
  const failed = pages.find((page) => page.isError)
  /** A billing date in the tenant's zone. */
  const date = (iso: string) => formatBillingDate(iso, timeZone)

  let body
  if (first?.data === undefined && failed === undefined) body = <CardRowsSkeleton rows={3} />
  else if (rows.length === 0 && failed === undefined) {
    body = <EmptyState size="compact" title="No invoices yet." />
  } else {
    body = (
      <>
        {rows.length > 0 && (
          <Table aria-label="Invoices">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Invoice</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>{date(invoice.issuedAt)}</TableCell>
                  <TableCell>{formatInr(invoice.amountMinor)}</TableCell>
                  <TableCell>{STATUS_LABEL[invoice.status]}</TableCell>
                  <TableCell>
                    {invoice.url !== null && (
                      <a
                        href={invoice.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`View invoice of ${date(invoice.issuedAt)}`}
                        className="text-sm font-medium underline-offset-4 hover:underline"
                      >
                        View
                      </a>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {failed !== undefined && (
          <LoadError
            message="Invoices didn’t load. Try again."
            onRetry={() => void failed.refetch()}
          />
        )}
        {last?.data?.page.hasNext === true && last.data.page.nextCursor !== null && (
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={last.isPending}
              onClick={() => {
                const next = last.data?.page.nextCursor
                if (next) setCursors((shown) => [...shown, next])
              }}
            >
              Show more
            </Button>
          </div>
        )}
        {last !== undefined && last.isPending && cursors.length > 1 && (
          <CardRowsSkeleton rows={1} />
        )}
      </>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Invoices</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">{body}</CardContent>
    </Card>
  )
}
