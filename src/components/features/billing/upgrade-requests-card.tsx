import { useQuery } from '@tanstack/react-query'
import { Pii } from '@/components/shared/pii'
import { QueryState } from '@/components/shared/query-state'
import { CardRowsSkeleton } from '@/components/shared/section-skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatBillingDate } from '@/lib/billing-format'
import { upgradeRequestsQueryOptions } from '@/queries/billing.queries'

/**
 * Billing's "Upgrade requests" card: who asked the owners to upgrade, and
 * when, oldest first. An empty name reads "A member". Renders nothing while the
 * list loads and when no one asked. Mount it only for an owner with member access: the API refuses
 * everyone else.
 */
export function UpgradeRequestsCard({ slug, timeZone }: { slug: string; timeZone: string }) {
  const requests = useQuery(upgradeRequestsQueryOptions(slug))
  // Most workspaces have no requests, so a skeleton would show a card that then vanishes.
  if (requests.isPending || requests.data?.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Upgrade requests</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <QueryState
          query={requests}
          name="Upgrade requests"
          skeleton={<CardRowsSkeleton rows={1} />}
        >
          {(rows) => (
            <ul className="grid gap-2 text-sm">
              {rows.map((request) => (
                <li key={request.id}>
                  {request.requestedBy.name === '' ? (
                    'A member'
                  ) : (
                    <Pii>{request.requestedBy.name}</Pii>
                  )}
                  {` asked to upgrade on ${formatBillingDate(request.createdAt, timeZone)}.`}
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </CardContent>
    </Card>
  )
}
