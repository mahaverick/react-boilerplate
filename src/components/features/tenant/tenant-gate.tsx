import { IconBuildingOff, IconLock } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { BillingBanner } from '@/components/features/billing/billing-banner'
import { PlatformAccessBanner } from '@/components/features/platform-access-banner'
import { EmptyState } from '@/components/shared/empty-state'
import { QueryState } from '@/components/shared/query-state'
import { useTenant, useTenants, type TenantWithRole } from '@/queries/tenant.queries'
import { useRememberTenant } from '@/states/current-tenant.store'

/** Said of the request, not of the tenant: unlike `TenantNotFound`, the tenant may be fine. */
export const TENANT_LOAD_ERROR =
  'We couldn’t load this tenant because the request failed. Try again.'

/**
 * What a 404 looks like. `GET /tenants/:slug` answers the same 404 for "no such
 * tenant" and "no access", and this copy does not guess between them: "you are
 * not a member of acme" would confirm that acme exists.
 */
function TenantNotFound({ slug, heading: Heading }: { slug: string; heading: GateHeading }) {
  return (
    <EmptyState
      icon={<IconBuildingOff aria-hidden="true" />}
      title={<Heading>Tenant not available</Heading>}
      description={
        <>
          We couldn’t open <span className="font-medium">/{slug}</span>. It doesn’t exist, or you
          aren’t a member.
        </>
      }
      action={
        <Link to="/tenants" className="text-sm underline underline-offset-4">
          Back to your tenants
        </Link>
      }
    />
  )
}

/**
 * A tenant the caller belongs to but that staff have suspended. Its own
 * routes answer 404 like a missing tenant, so the tenant list (which still
 * carries it, with its state) is what tells the two apart. Only the caller's
 * own memberships reach this, so it confirms nothing about other tenants.
 */
function TenantSuspended({ name, heading: Heading }: { name: string; heading: GateHeading }) {
  return (
    <EmptyState
      icon={<IconLock aria-hidden="true" />}
      title={<Heading>Tenant suspended</Heading>}
      description={
        <>
          <span className="font-medium">{name}</span> is suspended, so its pages are closed.
          <span className="mt-2 block">Contact support to restore access.</span>
        </>
      }
      action={
        <Link to="/tenants" className="text-sm underline underline-offset-4">
          Back to your tenants
        </Link>
      }
    />
  )
}

/**
 * The element the gate's not-found and suspended panels title themselves with:
 * `h1` where the panel is the page, `h2` under a layout that has its own `h1`.
 */
type GateHeading = 'h1' | 'h2'

/** A tenant detail as `useTenant` returns it once loaded. */
export type LoadedTenant = NonNullable<ReturnType<typeof useTenant>['data']>

/**
 * What every tenant layout renders around its page: `skeleton` while the
 * tenant loads; the load-error panel when the read fails; for a 404 (`null`)
 * the suspended or not-found panel, which the tenant list decides; otherwise
 * the platform-access banner when staff reached it by platform access, the
 * billing banner on a customer tenant, then the page. A loaded tenant the
 * user reached as a member, other than the platform tenant, becomes the
 * user's remembered tenant for Settings.
 * `heading` is the panels' title element, `h2` under a layout with its own `h1`.
 * `billingBannerActions: false`, for the Billing page, keeps the billing
 * banner's sentence but drops its card button and Upgrade link: the page runs
 * its own checkout.
 */
export function TenantGate({
  slug,
  heading = 'h1',
  billingBannerActions = true,
  skeleton,
  children,
}: {
  slug: string
  heading?: GateHeading
  billingBannerActions?: boolean
  skeleton: ReactNode
  children: (tenant: LoadedTenant) => ReactNode
}) {
  const tenant = useTenant(slug)
  // Only a tenant the user works in becomes the remembered one: staff visits and the platform tenant would otherwise replace it.
  useRememberTenant(
    slug,
    !!tenant.data && tenant.data.access !== 'platform' && !tenant.data.isPlatform
  )

  /** The page, or the 404 panels, for a detail that has loaded. */
  const loaded = (detail: LoadedTenant | null) =>
    detail === null ? (
      <MissingTenant slug={slug} heading={heading} skeleton={skeleton} />
    ) : (
      <>
        {detail.access === 'platform' && (
          <PlatformAccessBanner tenantName={detail.name} role={detail.role} />
        )}
        {!detail.isPlatform && (
          <BillingBanner slug={slug} tenant={detail} actions={billingBannerActions} />
        )}
        {children(detail)}
      </>
    )

  // A failed refetch with the tenant on screen is the sections' to show (`useMyRole`), not a second alert over the page.
  if (tenant.data !== undefined) return loaded(tenant.data)
  return (
    <QueryState query={tenant} name="Tenant" errorMessage={TENANT_LOAD_ERROR} skeleton={skeleton}>
      {loaded}
    </QueryState>
  )
}

/**
 * A tenant the API answered 404 for: suspended when the caller's list says
 * so, else not found. The 404 invalidates the list, so it waits for that
 * refetch; a failed list cannot tell the two apart, so it claims neither.
 */
function MissingTenant({
  slug,
  heading,
  skeleton,
}: {
  slug: string
  heading: GateHeading
  skeleton: ReactNode
}) {
  const tenants = useTenants()
  if (tenants.isFetching && !tenants.isError) return skeleton
  /** The suspended or not-found panel, as `list` tells them apart. */
  const panel = (list: readonly TenantWithRole[]) => {
    const listed = list.find((entry) => entry.tenant.slug === slug)
    return listed?.tenant.lifecycleState === 'suspended' ? (
      <TenantSuspended name={listed.tenant.name} heading={heading} />
    ) : (
      <TenantNotFound slug={slug} heading={heading} />
    )
  }
  // A cached list whose refetch failed still decides: a load error above the panel would contradict it.
  if (tenants.data !== undefined) return panel(tenants.data)
  return (
    <QueryState query={tenants} name="Tenants" errorMessage={TENANT_LOAD_ERROR} skeleton={skeleton}>
      {panel}
    </QueryState>
  )
}
