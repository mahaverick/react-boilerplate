import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { DetailTabPending } from '@/components/shared/pending-templates'
import { QueryState } from '@/components/shared/query-state'
import { CardRowsSkeleton } from '@/components/shared/section-skeleton'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { pageTitle } from '@/constants/app'
import { statusFrom } from '@/lib/api-error'
import { flagKeys } from '@/observability/flags/flag-query'
import { requireClientFlag } from '@/observability/flags/require-client-flag'
import { useTenantBeta } from '@/queries/beta.queries'

/**
 * The reference flag-gated page. It exists only while `example_beta_page` is
 * on for this tenant: `beforeLoad` answers not found otherwise, as the API
 * route behind it answers 404.
 */
export const Route = createFileRoute('/_app/tenants/$slug/beta')({
  beforeLoad: ({ context, params }) =>
    requireClientFlag(
      context.queryClient,
      { kind: 'tenant', slug: params.slug },
      'example_beta_page'
    ),
  head: ({ params }) => ({ meta: [{ title: pageTitle(`Beta · ${params.slug}`) }] }),
  staticData: { crumb: 'Beta' },
  component: TenantBetaTab,
  pendingComponent: DetailTabPending,
})

/** Said when the beta route failed; a 404 there means the flag closed after the page opened. */
const BETA_ERROR = 'We could not load the beta features for this tenant.'

/** Shows the beta confirmation; when the API 404s because the flag closed, re-runs the route guard. */
function TenantBetaTab() {
  const { slug } = Route.useParams()
  const beta = useTenantBeta(slug)
  const queryClient = useQueryClient()
  const router = useRouter()
  const isClosed = beta.isError && statusFrom(beta.error) === 404
  const { errorUpdatedAt } = beta

  // Once per 404: re-read the tenant's flags, then re-run `beforeLoad`, so a closed flag shows not found and drops the tab.
  useEffect(() => {
    if (!isClosed) return
    void queryClient
      .invalidateQueries({ queryKey: flagKeys.tenant(slug), refetchType: 'all' })
      .then(() => router.invalidate())
  }, [isClosed, errorUpdatedAt, queryClient, router, slug])

  return (
    <QueryState query={beta} name="Beta" errorMessage={BETA_ERROR} skeleton={<BetaSkeleton />}>
      {(data) => (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Beta</h2>
            </CardTitle>
            <CardDescription>Features this tenant sees before everyone else.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm">Beta features are on for {data.slug}.</p>
          </CardContent>
        </Card>
      )}
    </QueryState>
  )
}

/** The beta card's place while it loads: its title, description and the one line of content. */
function BetaSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-64" />
      </CardHeader>
      <CardContent>
        <CardRowsSkeleton rows={1} rowHeight="1.25rem" />
      </CardContent>
    </Card>
  )
}
