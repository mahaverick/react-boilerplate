import { IconBuildingOff, IconLock } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { PlatformAccessBanner } from '@/components/features/platform-access-banner'
import { EmptyState } from '@/components/shared/empty-state'
import { QueryState } from '@/components/shared/query-state'
import { useTenant, useTenants } from '@/queries/tenant.queries'
import { useRememberTenant } from '@/states/current-tenant.store'

/** Said of the request, not of the tenant: unlike `TenantNotFound`, the tenant may be fine. */
export const TENANT_LOAD_ERROR =
  'We could not load this tenant. The request failed, which is not the same as the tenant being gone.'

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
          We could not open <span className="font-medium">/{slug}</span>. Either it does not exist
          or it is not one of yours.
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
          <span className="font-medium">{name}</span> is unavailable right now.
          <span className="mt-2 block">This tenant is suspended. Contact support.</span>
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
 * the platform-access banner when staff reached it by platform access, then
 * the page. A loaded tenant the user reached as a member, other than the
 * platform tenant, becomes the user's remembered tenant for Settings.
 * `heading` is the panels' title element, `h2` under a layout with its own `h1`.
 */
export function TenantGate({
  slug,
  heading = 'h1',
  skeleton,
  children,
}: {
  slug: string
  heading?: GateHeading
  skeleton: ReactNode
  children: (tenant: LoadedTenant) => ReactNode
}) {
  const tenant = useTenant(slug)
  // Only a tenant the user works in becomes the remembered one: staff visits and the platform tenant would otherwise replace it.
  useRememberTenant(
    slug,
    !!tenant.data && tenant.data.access !== 'platform' && !tenant.data.isPlatform
  )

  return (
    <QueryState query={tenant} name="Tenant" errorMessage={TENANT_LOAD_ERROR} skeleton={skeleton}>
      {(detail) =>
        detail === null ? (
          <MissingTenant slug={slug} heading={heading} skeleton={skeleton} />
        ) : (
          <>
            {detail.access === 'platform' && (
              <PlatformAccessBanner tenantName={detail.name} role={detail.role} />
            )}
            {children(detail)}
          </>
        )
      }
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
  return (
    <QueryState query={tenants} name="Tenants" errorMessage={TENANT_LOAD_ERROR} skeleton={skeleton}>
      {(list) => {
        const listed = list.find((entry) => entry.tenant.slug === slug)
        return listed?.tenant.lifecycleState === 'suspended' ? (
          <TenantSuspended name={listed.tenant.name} heading={heading} />
        ) : (
          <TenantNotFound slug={slug} heading={heading} />
        )
      }}
    </QueryState>
  )
}
