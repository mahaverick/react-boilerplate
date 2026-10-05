import { createFileRoute } from '@tanstack/react-router'
import { LoadError } from '@/components/features/load-error'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { pageTitle } from '@/constants/app'
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
})

/** Said when the beta route failed; a 404 there means the flag closed after the page opened. */
const BETA_ERROR = 'We could not load the beta features for this tenant.'

function TenantBetaTab() {
  const { slug } = Route.useParams()
  const beta = useTenantBeta(slug)

  if (beta.isPending) return <Skeleton className="h-32 w-full max-w-2xl" />
  if (beta.isError) return <LoadError message={BETA_ERROR} onRetry={() => void beta.refetch()} />

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>
          <h2>Beta</h2>
        </CardTitle>
        <CardDescription>Features this tenant sees before everyone else.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm">Beta features are on for {beta.data.slug}.</p>
      </CardContent>
    </Card>
  )
}
