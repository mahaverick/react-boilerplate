/**
 * @file The copyable example of a plan-gated page (`advanced_example`).
 *
 * Both guard styles are here. The UI gate: `FeatureGate` reads the plan's
 * entitlements and draws the locked card, so a Free workspace never asks the
 * API. The API gate: the route is behind `requireFeature('advanced_example')`,
 * which answers 402 `PLAN_FEATURE_REQUIRED`; the query resolves that to
 * `'locked'` and the page draws the same locked card, for a plan that changed
 * after the entitlements were read. To gate another page, copy this file,
 * change the key and the copy, and wrap the API route in `requireFeature`.
 */
import { createFileRoute } from '@tanstack/react-router'
import { FeatureGate } from '@/components/features/billing/feature-gate'
import { DetailTabPending } from '@/components/shared/pending-templates'
import { QueryState } from '@/components/shared/query-state'
import { CardRowsSkeleton } from '@/components/shared/section-skeleton'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { pageTitle } from '@/constants/app'
import { INSIGHTS_LOCKED, useTenantInsights, type TenantInsights } from '@/queries/insights.queries'

/** The Insights tab. Open to every member; the plan decides whether it shows the stats or the locked card. */
export const Route = createFileRoute('/_app/tenants/$slug/insights')({
  head: ({ params }) => ({ meta: [{ title: pageTitle(`Insights · ${params.slug}`) }] }),
  staticData: { crumb: 'Insights' },
  component: TenantInsightsTab,
  pendingComponent: DetailTabPending,
})

/** The feature's catalog key. */
const FEATURE = 'advanced_example'
/** The gate's title, the locked card's `h2`. */
const TITLE = 'Workspace insights'
/** The gate's value line. */
const VALUE_LINE = 'See who joined and how many invitations went out in the last 30 days.'

/** The Insights tab: the UI gate around the stats, which mount (and fetch) only when the plan includes the feature. */
function TenantInsightsTab() {
  const { slug } = Route.useParams()
  return (
    <FeatureGate slug={slug} entitlementKey={FEATURE} title={TITLE} valueLine={VALUE_LINE}>
      <InsightsStats slug={slug} />
    </FeatureGate>
  )
}

/**
 * The two stat cards. A 402 from the API draws the locked card, the second
 * guard, through `FeatureGate`'s `locked`.
 */
function InsightsStats({ slug }: { slug: string }) {
  const insights = useTenantInsights(slug)
  return (
    <QueryState query={insights} name="Insights" skeleton={<InsightsSkeleton />}>
      {(data) =>
        data === INSIGHTS_LOCKED ? (
          <FeatureGate
            slug={slug}
            entitlementKey={FEATURE}
            title={TITLE}
            valueLine={VALUE_LINE}
            locked
          >
            {null}
          </FeatureGate>
        ) : (
          <StatCards data={data} />
        )
      }
    </QueryState>
  )
}

/** The two counts, each in its own card under a shared section heading. */
function StatCards({ data }: { data: TenantInsights }) {
  return (
    <section aria-labelledby="insights-heading" className="grid gap-4">
      <h2 id="insights-heading" className="text-lg font-semibold">
        {TITLE}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Members joined, last 30 days" value={data.membersJoinedLast30Days} />
        <StatCard label="Invitations sent, last 30 days" value={data.invitationsSentLast30Days} />
      </div>
    </section>
  )
}

/** One stat: its label and count. */
function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  )
}

/** The stats' place while they load: a heading bar and two cards. */
function InsightsSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-6 w-48" />
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i}>
            <CardContent>
              <CardRowsSkeleton rows={1} rowHeight="2rem" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
