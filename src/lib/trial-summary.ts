/**
 * @file What changes when a Paid trial ends and the workspace moves to Free.
 * Pure: the entitlements, both plans and the catalog come in as arguments.
 */
import type {
  EntitlementCatalogEntry,
  EntitlementValue,
  TenantEntitlements,
} from '@/types/billing.types'

/** A plan's values, as `GET /plans` serves them. */
interface PlanValues {
  entitlements: Record<string, EntitlementValue>
}

/** One line of the summary: the catalog key, its label and the sentence shown. */
export interface TrialSummaryLine {
  key: string
  label: string
  line: string
}

/**
 * The lines of the trial-end summary, in catalog order. A limit is listed
 * when the workspace uses more than Free allows: "5 members (Free allows 3)",
 * the catalog label in lower case. A feature is listed when Paid has it and
 * Free does not: "Insights (Paid only)". The API keeps no per-feature use, so
 * every Paid-only feature is listed, whether or not the workspace used it.
 * Once the effective plan is Free, a feature still on or a limit above Free's
 * comes from a staff grant and does not change, so it is left out. An empty
 * list means nothing changes.
 * @param entitlements - The workspace's entitlements, whose `used` counts are read.
 * @param freePlan - The Free plan.
 * @param paidPlan - The Paid plan.
 * @param catalog - The catalog, for each key's kind and label.
 * @returns The lines; empty when usage fits Free and Paid has no feature Free lacks.
 */
export function trialSummary(
  entitlements: TenantEntitlements,
  freePlan: PlanValues,
  paidPlan: PlanValues,
  catalog: EntitlementCatalogEntry[]
): TrialSummaryLine[] {
  const onFree = entitlements.plan.key === 'free'
  const lines: TrialSummaryLine[] = []
  for (const { key, kind, label } of catalog) {
    const free = freePlan.entitlements[key]
    if (kind === 'limit') {
      const usage = entitlements.limits[key]
      if (typeof free !== 'number' || usage === undefined || usage.used <= free) continue
      const granted = onFree && (usage.limit === null || usage.limit > free)
      if (!granted) {
        lines.push({
          key,
          label,
          line: `${usage.used} ${label.toLowerCase()} (Free allows ${free})`,
        })
      }
      continue
    }
    const paidOnly = paidPlan.entitlements[key] === true && free === false
    const granted = onFree && entitlements.features[key] === true
    if (paidOnly && !granted) lines.push({ key, label, line: `${label} (Paid only)` })
  }
  return lines
}
