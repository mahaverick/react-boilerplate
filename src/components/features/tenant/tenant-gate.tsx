import { IconBuildingOff, IconLock } from '@tabler/icons-react'
import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { useEffect, type ReactNode } from 'react'
import { LoadError } from '@/components/features/load-error'
import { PlatformAccessBanner } from '@/components/features/platform-access-banner'
import { EmptyState } from '@/components/shared/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { noteError } from '@/observability/errors'
import { useTenant, useTenants } from '@/queries/tenant.queries'
import { useRememberTenant } from '@/states/current-tenant.store'

/** Said of the request, not of the tenant: unlike `TenantNotFound`, the tenant may be fine. */
export const TENANT_LOAD_ERROR =
  'We could not load this tenant. The request failed, which is not the same as the tenant being gone.'

/**
 * The route's error boundary. Retry is `router.invalidate()`, which re-runs
 * the loader; `ensureQueryData` finds no data and fetches again. The error
 * goes to error tracking on mount, which drops it when it is the API's.
 */
export function TenantLoadFailed({ error }: ErrorComponentProps) {
  const router = useRouter()

  useEffect(() => {
    noteError(error, 'router', true)
  }, [error])

  return <LoadError message={TENANT_LOAD_ERROR} onRetry={() => void router.invalidate()} />
}

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
 * What every tenant layout renders around its page: a skeleton while the
 * tenant loads; the suspended, load-error or not-found panel when there is no
 * tenant (the list decides between suspended and missing); otherwise the
 * platform-access banner when staff reached it by platform access, then the
 * page. A loaded tenant the user reached as a member, other than the platform
 * tenant, becomes the user's remembered tenant for Settings.
 * `heading` is the panels' title element, `h2` under a layout with its own `h1`.
 */
export function TenantGate({
  slug,
  heading = 'h1',
  children,
}: {
  slug: string
  heading?: GateHeading
  children: (tenant: LoadedTenant) => ReactNode
}) {
  const tenant = useTenant(slug)
  const tenants = useTenants()
  const listed = tenants.data?.find((entry) => entry.tenant.slug === slug)
  // Only a tenant the user works in becomes the remembered one: staff visits and the platform tenant would otherwise replace it.
  useRememberTenant(
    slug,
    !!tenant.data && tenant.data.access !== 'platform' && !tenant.data.isPlatform
  )

  // With no tenant, the list decides between suspended and not found, so wait for it.
  if (tenant.isPending || (!tenant.data && (tenants.isPending || tenants.isFetching))) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (!tenant.data) {
    if (listed?.tenant.lifecycleState === 'suspended') {
      return <TenantSuspended name={listed.tenant.name} heading={heading} />
    }
    // A failed list cannot tell suspended from missing, so it claims neither.
    if (tenants.isError) {
      return <LoadError message={TENANT_LOAD_ERROR} onRetry={() => void tenants.refetch()} />
    }
    return <TenantNotFound slug={slug} heading={heading} />
  }

  return (
    <>
      {tenant.data.access === 'platform' && (
        <PlatformAccessBanner tenantName={tenant.data.name} role={tenant.data.role} />
      )}
      {children(tenant.data)}
    </>
  )
}
