import { useInfiniteQuery } from '@tanstack/react-query'
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
 * The invoice's link when it is an `https:` URL, else `null`. Razorpay sends
 * the URL through express; a scheme check keeps any other value, such as a
 * `javascript:` one, out of an `href`.
 * @param url - The invoice's `url`, as the API sent it.
 */
function httpsUrl(url: string | null): string | null {
  if (url === null) return null
  try {
    return new URL(url).protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/**
 * Billing's "Invoices" card, for an owner with member access while payments
 * are on: date, amount, status and, where Razorpay gave an `https:` one, a link
 * that opens the invoice in a new tab. Pages are read one cursor at a time; "Show more"
 * adds the next under the ones shown, and a billing change starts over from
 * the first. Mount it only for that owner: the API refuses everyone else and
 * answers 404 while payments are off.
 */
export function InvoicesCard({ slug, timeZone }: { slug: string; timeZone: string }) {
  const invoices = useInfiniteQuery({ ...invoicesQueryOptions(slug), retry: false })
  const rows = invoices.data?.pages.flatMap((page) => page.items) ?? []
  const failed = invoices.isError
  /** A billing date in the tenant's zone. */
  const date = (iso: string) => formatBillingDate(iso, timeZone)

  let body
  if (invoices.data === undefined && !failed) body = <CardRowsSkeleton rows={3} />
  else if (rows.length === 0 && !failed) {
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
              {rows.map((invoice) => {
                const href = httpsUrl(invoice.url)
                return (
                  <TableRow key={invoice.id}>
                    <TableCell>{date(invoice.issuedAt)}</TableCell>
                    <TableCell>{formatInr(invoice.amountMinor)}</TableCell>
                    <TableCell>{STATUS_LABEL[invoice.status]}</TableCell>
                    <TableCell>
                      {href !== null && (
                        <a
                          href={href}
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
                )
              })}
            </TableBody>
          </Table>
        )}
        {failed && (
          <LoadError
            message="Invoices didn’t load. Try again."
            onRetry={() =>
              void (invoices.isFetchNextPageError ? invoices.fetchNextPage() : invoices.refetch())
            }
          />
        )}
        {invoices.hasNextPage && !invoices.isFetchNextPageError && (
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={invoices.isFetchingNextPage}
              onClick={() => void invoices.fetchNextPage()}
            >
              Show more
            </Button>
          </div>
        )}
        {invoices.isFetchingNextPage && <CardRowsSkeleton rows={1} />}
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
