import { IconLock } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import { UpgradeAction } from '@/components/features/billing/upgrade-action'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useFeature } from '@/queries/billing.queries'

/** A Paid-only feature's gate: the feature, and what to show in its place when the plan lacks it. */
interface FeatureGateProps {
  slug: string
  /** The catalog key, such as `advanced_example`. */
  entitlementKey: string
  /** The feature's name, the locked card's `h2`. */
  title: string
  /** One sentence on what the feature gives. */
  valueLine: string
  /** Draw the locked card whatever the entitlements say, for a feature route that answered 402. */
  locked?: boolean
  children: ReactNode
}

/**
 * Renders `children` when the plan includes the feature. Otherwise a locked
 * card: the title, the value line, "Included in Paid." and the viewer's
 * upgrade path. Renders nothing until the entitlements load, so the caller
 * owns any skeleton. `locked` draws the card regardless, for a feature route
 * that answered 402 while the entitlements read still said enabled. The API still refuses the feature's own requests; this
 * only decides what to draw.
 */
export function FeatureGate({
  slug,
  entitlementKey,
  title,
  valueLine,
  locked = false,
  children,
}: FeatureGateProps) {
  const { enabled } = useFeature(slug, entitlementKey)
  if (!locked) {
    if (enabled === undefined) return null
    if (enabled) return children
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="flex items-center gap-2">
            <IconLock aria-hidden="true" className="size-4 text-muted-foreground" />
            {title}
          </h2>
        </CardTitle>
        <CardDescription>{valueLine}</CardDescription>
      </CardHeader>
      <CardContent className="grid justify-items-start gap-3">
        <p className="text-sm">Included in Paid.</p>
        <UpgradeAction slug={slug} surface="feature" entitlementKey={entitlementKey} />
      </CardContent>
    </Card>
  )
}
