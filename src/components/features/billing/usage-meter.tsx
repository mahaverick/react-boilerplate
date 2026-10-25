import { countOf, nounFor } from '@/lib/plural'
import { cn } from '@/lib/utils'
import type { LimitUsage } from '@/types/billing.types'

/** How full a limit is: below the soft limit, near it (the server's `approaching`), or at or over it. */
type MeterTone = 'normal' | 'approaching' | 'full'

/** The fill colour for each tone. */
const FILL_CLASS: Record<MeterTone, string> = {
  normal: 'bg-primary',
  approaching: 'bg-warning-strong',
  full: 'bg-destructive',
}

/**
 * The tone of a limited usage. `approaching` comes from the server, which
 * knows the plan's soft limit; the client does not.
 * @param usage - A usage with a number for its limit.
 * @returns The tone to draw.
 */
function toneOf(usage: LimitUsage & { limit: number }): MeterTone {
  if (usage.used >= usage.limit) return 'full'
  return usage.approaching ? 'approaching' : 'normal'
}

/**
 * One limit's use: "3 of 3 members" over a bar, or "7 members · No limit"
 * and no bar when the plan has none. The noun follows the number before it:
 * "1 member · No limit", "1 of 3 members", "1 of 1 member". The bar is a
 * `role="meter"` named by `label`, with the sentence as its value text. Over
 * the limit, the bar stays full and `aria-valuenow` stops at the maximum, as a
 * meter's value must, while the text and value text keep the true count.
 * @param props.label - The catalog label, such as "Members".
 * @param props.usage - The limit's use, from the entitlements.
 */
export function UsageMeter({ label, usage }: { label: string; usage: LimitUsage }) {
  const noun = label.toLowerCase()
  if (usage.limit === null) {
    return (
      <p className="text-sm text-muted-foreground">{`${countOf(usage.used, noun)} · No limit`}</p>
    )
  }
  const limited = { ...usage, limit: usage.limit }
  const tone = toneOf(limited)
  const text = `${String(usage.used)} of ${String(usage.limit)} ${nounFor(usage.limit, noun)}`
  const percent = usage.limit > 0 ? Math.min(100, (usage.used / usage.limit) * 100) : 100
  return (
    <div className="grid gap-1.5">
      <p className="text-sm text-muted-foreground">{text}</p>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={usage.limit}
        aria-valuenow={Math.min(usage.used, usage.limit)}
        aria-valuetext={text}
        data-tone={tone}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          data-slot="meter-fill"
          className={cn('h-full rounded-full', FILL_CLASS[tone])}
          style={{ width: `${String(percent)}%` }}
        />
      </div>
    </div>
  )
}
