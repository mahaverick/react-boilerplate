import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { BusyButton } from '@/components/shared/busy-button'
import { buttonVariants } from '@/components/ui/button'
import { codeFrom, messageFrom } from '@/lib/api-error'
import { formatBillingDate } from '@/lib/billing-format'
import { toast } from '@/lib/toast'
import { track, type AnalyticsKey } from '@/observability/telemetry'
// Not re-exported from the telemetry index: the index is byte for byte apex's, and this helper belongs to this app's registry.
import { entitlementAnalyticsKey } from '@/observability/telemetry/event-registry'
import { invalidateBilling, useRequestUpgrade } from '@/queries/billing.queries'
import { tenantSettingsQueryOptions } from '@/queries/tenant-forms.queries'
import { useMyRole } from '@/queries/tenant.queries'
import { ALREADY_PAID } from '@/types/api.types'
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

  if (isRequested) return <span className="text-sm text-muted-foreground">Requested</span>

  /** Posts the request with the raw catalog key, which the API validates; analytics gets the fixed key. */
  const ask = () => {
    request.mutate(entitlementKey === undefined ? { surface } : { key: entitlementKey, surface }, {
      onSuccess: (result) => {
        setIsRequested(true)
        if (!result.alreadyRequested) {
          track('upgrade_requested_ui', eventProps)
          toast.success(REQUEST_SENT)
          return
        }
        void alreadyAskedMessage(queryClient, slug, result).then((message) => {
          toast.success(message)
        })
      },
      onError: (error) => {
        toast.error(messageFrom(error))
        if (codeFrom(error) === ALREADY_PAID) void invalidateBilling(queryClient, slug)
      },
    })
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
  const timeZone = await queryClient
    .ensureQueryData({ ...tenantSettingsQueryOptions(slug), retry: false })
    .then(
      (settings) => settings.timezone,
      () => 'UTC'
    )
  return `You already asked on ${formatBillingDate(result.createdAt, timeZone)}. Owners were told.`
}
