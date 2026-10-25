import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { BusyButton } from '@/components/shared/busy-button'
import { buttonVariants } from '@/components/ui/button'
import { useFocusAfter } from '@/hooks/use-focus-after'
import { codeFrom, messageFrom } from '@/lib/api-error'
import { formatBillingDate } from '@/lib/billing-format'
import { entitlementAnalyticsKey } from '@/lib/entitlement-key'
import { toast } from '@/lib/toast'
import { track, type AnalyticsKey } from '@/observability/telemetry'
import { invalidateBilling, useRequestUpgrade } from '@/queries/billing.queries'
import { billingTimeZone } from '@/queries/tenant-forms.queries'
import { useMyRole } from '@/queries/tenant.queries'
import { ALREADY_PAID } from '@/types/billing.types'
import type { UpgradeRequestResult, UpgradeSurface } from '@/types/billing.types'

/** Where an upgrade prompt sits and what it is for. */
interface UpgradeActionProps {
  /** The tenant, from `useCurrentTenantSlug()` or the route's `$slug`. */
  slug: string
  /** The surface the prompt sits on, for the request and analytics. */
  surface: UpgradeSurface
  /** The catalog key the prompt is about, such as `members`; omitted for a general prompt. */
  entitlementKey?: string
  /** The button size; `sm` by default. */
  size?: 'sm' | 'default'
}

/** The analytics properties of every upgrade event: the surface, and the entitlement when there is one. */
type UpgradeEventProps = { surface: UpgradeSurface; key?: AnalyticsKey }

/**
 * The upgrade events' properties.
 * @param surface - Where the prompt sits.
 * @param key - The entitlement's fixed analytics key, when the prompt has one.
 * @returns The properties, without `key` when there is none.
 */
function eventPropsOf(surface: UpgradeSurface, key: AnalyticsKey | undefined): UpgradeEventProps {
  return key === undefined ? { surface } : { surface, key }
}

/** What the request toast says on success. */
const REQUEST_SENT = 'Request sent. Owners will see it in their notifications.'

/**
 * The upgrade path a viewer may take. An owner with member access gets an
 * "Upgrade" link to Billing; any other member gets "Request upgrade", which
 * asks the owners; staff through platform access get nothing, since only
 * members may pay or ask. Nothing renders until the role is known. Each mount
 * that shows something tracks `upgrade_prompt_viewed` once.
 */
export function UpgradeAction({ slug, surface, entitlementKey, size = 'sm' }: UpgradeActionProps) {
  const { role, access } = useMyRole(slug)
  const kind =
    role === undefined || access !== 'member' ? null : role === 'owner' ? 'upgrade' : 'request'
  const key = entitlementKey === undefined ? undefined : entitlementAnalyticsKey(entitlementKey)
  const props = eventPropsOf(surface, key)
  const viewed = useRef(false)

  useEffect(() => {
    if (kind === null || viewed.current) return
    viewed.current = true
    track('upgrade_prompt_viewed', eventPropsOf(surface, key))
  }, [kind, surface, key])

  if (kind === null) return null
  if (kind === 'upgrade') {
    return (
      <Link
        to="/settings/workspace/$slug/billing"
        params={{ slug }}
        className={buttonVariants({ size })}
        onClick={() => track('upgrade_clicked', props)}
      >
        Upgrade
      </Link>
    )
  }
  return (
    <RequestUpgrade
      slug={slug}
      surface={surface}
      entitlementKey={entitlementKey}
      size={size}
      eventProps={props}
    />
  )
}

/**
 * "Request upgrade": asks the owners, then reads "Requested". A repeat ask
 * says when the first one was. Any refusal shows the server's message; an
 * `ALREADY_PAID` one also refetches billing, so a stale gate opens.
 */
function RequestUpgrade({
  slug,
  surface,
  entitlementKey,
  size,
  eventProps,
}: Required<Pick<UpgradeActionProps, 'slug' | 'surface' | 'size'>> &
  Pick<UpgradeActionProps, 'entitlementKey'> & { eventProps: UpgradeEventProps }) {
  const queryClient = useQueryClient()
  const request = useRequestUpgrade(slug)
  const [isRequested, setIsRequested] = useState(false)
  // The button unmounts on success; without this, keyboard focus drops to <body>.
  const focus = useFocusAfter<'requested'>()

  if (isRequested) {
    return (
      <span
        ref={focus.target('requested')}
        tabIndex={-1}
        className="text-sm text-muted-foreground outline-none"
      >
        Requested
      </span>
    )
  }

  /**
   * Posts the request with the raw catalog key, which the API validates;
   * analytics gets the fixed key. A promise, not per-call `mutate` callbacks:
   * TanStack drops those if the prompt unmounts while the request is in
   * flight, and the toast and the event must still follow.
   */
  const ask = () => {
    void request
      .mutateAsync(entitlementKey === undefined ? { surface } : { key: entitlementKey, surface })
      .then(
        (result) => {
          setIsRequested(true)
          focus.focusAfter('requested')
          if (!result.alreadyRequested) {
            track('upgrade_requested_ui', eventProps)
            toast.success(REQUEST_SENT)
            return
          }
          void alreadyAskedMessage(queryClient, slug, result).then((message) => {
            toast.success(message)
          })
        },
        (error: unknown) => {
          toast.error(messageFrom(error))
          if (codeFrom(error) === ALREADY_PAID) void invalidateBilling(queryClient, slug)
        }
      )
  }

  return (
    <BusyButton
      variant="outline"
      size={size}
      busy={request.isPending}
      busyLabel="Sending…"
      onClick={ask}
    >
      Request upgrade
    </BusyButton>
  )
}

/**
 * "You already asked on 2 November 2026. Owners were told.", dated in the
 * tenant's time zone as the server dates its messages, or in UTC when the
 * settings cannot be read.
 * @param queryClient - The app's query client, which may hold the settings already.
 * @param slug - The tenant.
 * @param result - The request's answer, whose `createdAt` is the first ask.
 * @returns The toast's text.
 */
async function alreadyAskedMessage(
  queryClient: QueryClient,
  slug: string,
  result: UpgradeRequestResult
): Promise<string> {
  const timeZone = await billingTimeZone(queryClient, slug)
  return `You already asked on ${formatBillingDate(result.createdAt, timeZone)}. Owners were told.`
}
