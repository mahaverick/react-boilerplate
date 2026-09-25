import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MembershipRole } from '@/constants/roles'
import { apiClient, unwrap } from '@/http/client'
import { codeFrom, statusFrom } from '@/lib/api-error'
import type {
  InviteMemberInput,
  NewTenantInput,
  UpdateTenantInput,
  UpdateTenantSettingsInput,
} from '@/schemas/tenant.schemas'
import {
  INVITATION_CONFLICT,
  type ApiSuccess,
  type TenantAccess,
  type TenantInvitation,
} from '@/types/api.types'

/**
 * A whole `tenants` row, as `TenantRepository` returns it — `db.select()`
 * with no projection, so every column is on the wire including the soft
 * delete bookkeeping.
 */
export interface Tenant {
  id: string
  name: string
  slug: string
  description: string | null
  logo: string | null
  website: string | null
  /** 'active' | 'suspended' | 'archived'. */
  lifecycleState: string
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  /** The one platform tenant. Never reachable through platform access. */
  isPlatform: boolean
}

/** A `user_memberships` row. */
export interface TenantMembership {
  id: string
  userId: string
  tenantId: string
  role: MembershipRole
  createdAt: string
  updatedAt: string
}

/**
 * One row of `GET /tenants/:slug/members`.
 *
 * `user` is an explicit four-column projection on the server, never the
 * whole users row — there is no `createdAt` here and, deliberately, no
 * `passwordHash`.
 */
export interface TenantMember {
  membership: TenantMembership
  user: { id: string; email: string; firstName: string | null; lastName: string | null }
}

/** One row of `GET /tenants`: the tenant plus the caller's membership role in it. */
export interface TenantWithRole {
  tenant: Tenant
  role: MembershipRole
  /** The platform tenant's row, which the switcher leaves out and the user menu links instead. */
  isPlatform: boolean
}

/**
 * `GET /tenants/:slug`: the row plus the caller's EFFECTIVE role there and
 * how they reached it. A member's role wins over any platform role, so
 * `access: 'platform'` only ever appears in a tenant the caller is not in.
 */
export interface TenantDetail extends Tenant {
  role: MembershipRole
  access: TenantAccess
}

/** A `tenant_settings` row. Both text columns are NOT NULL with defaults. */
export interface TenantSettings {
  tenantId: string
  timezone: string
  locale: string
  metadata: Record<string, unknown> | null
  updatedAt: string
}

/**
 * `['tenants']` is a PREFIX of every other key here, so invalidating it
 * without `exact: true` refetches every open detail, member and settings
 * query as well. Each mutation below invalidates the narrowest key that
 * actually changed, and says `exact: true` when it means the list alone.
 */
export const tenantKeys = {
  list: ['tenants'] as const,
  detail: (slug: string) => ['tenants', slug] as const,
  members: (slug: string) => ['tenants', slug, 'members'] as const,
  settings: (slug: string) => ['tenants', slug, 'settings'] as const,
  invitations: (slug: string) => ['tenants', slug, 'invitations'] as const,
}

export function useTenants() {
  return useQuery({
    queryKey: tenantKeys.list,
    queryFn: async () => unwrap(await apiClient.get<ApiSuccess<TenantWithRole[]>>('/tenants')),
  })
}

/**
 * One tenant, where NOT FOUND IS A VALUE (`null`), not a rejection.
 *
 * `GET /tenants/:slug` answers an identical 404 for "no such tenant" and
 * "you are not a member" (Ruling G), and both are a page state, not an
 * error: the route must render a not-found panel rather than an error
 * boundary, and must not let the caller tell the two apart.
 *
 * Resolving to `null` rather than rejecting is what makes that work end to
 * end. A rejected query would (a) be retried by the router's `retry: 1`
 * default, (b) be refetched again on mount by `retryOnMount`, and (c) make
 * `ensureQueryData` throw inside `$slug.tsx`'s loader, which is the error
 * boundary this must avoid. Every OTHER failure — a 500, a dropped
 * connection — still rejects and still reaches the boundary, which is
 * where an unexpected failure belongs.
 */
export function tenantQueryOptions(slug: string) {
  return queryOptions({
    queryKey: tenantKeys.detail(slug),
    queryFn: async () => {
      try {
        return unwrap(await apiClient.get<ApiSuccess<TenantDetail>>(`/tenants/${slug}`))
      } catch (error) {
        if (statusFrom(error) === 404) return null
        throw error
      }
    },
  })
}

export function useTenant(slug: string) {
  return useQuery(tenantQueryOptions(slug))
}

/**
 * The caller's EFFECTIVE role in one tenant, and how they reached it.
 *
 * Read off `GET /tenants/:slug`, not the tenant list. Staff opening a tenant
 * they don't belong to have no list row for it, and their role there is
 * their platform role. The detail is the one response that carries the role
 * the API will actually enforce. Every role-gated control reads this, so the
 * existing predicates already disable the right things under platform access.
 *
 * THREE states, not two, and keeping them apart is the point. `isPending` is
 * "not known YET", and a screen renders a skeleton for it. `isError` is "not
 * knowable right now", and a screen must say so and offer a retry. A first
 * load that fails never gets here: `$slug.tsx`'s error boundary catches it.
 * So this is a REFETCH that failed, with the cached row still in place. A
 * role of `undefined` after a successful load is the third state: a 404,
 * which the layout has already turned into its not-found panel.
 */
export function useMyRole(slug: string): {
  role: MembershipRole | undefined
  access: TenantAccess | undefined
  isPending: boolean
  isError: boolean
  /** Refetch the tenant. Hand this to the error state's retry control. */
  retry: () => void
} {
  const tenant = useTenant(slug)
  const { refetch } = tenant
  return {
    role: tenant.data?.role,
    access: tenant.data?.access,
    isPending: tenant.isPending,
    isError: tenant.isError,
    retry: () => void refetch(),
  }
}

export function useCreateTenant() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: NewTenantInput) =>
      unwrap(await apiClient.post<ApiSuccess<Tenant>>('/tenants', input)),
    // `exact`, or this would also refetch every detail/members/settings
    // query currently mounted — none of which a new tenant changes.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tenantKeys.list, exact: true }),
  })
}

export function useUpdateTenant(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateTenantInput) =>
      unwrap(await apiClient.patch<ApiSuccess<Tenant>>(`/tenants/${slug}`, input)),
    onSuccess: async () => {
      // Both: the detail query holds this tenant, and the LIST carries its
      // name too — the switcher and the tenant list would otherwise keep
      // showing the old one until something else refetched them.
      await queryClient.invalidateQueries({ queryKey: tenantKeys.detail(slug) })
      await queryClient.invalidateQueries({ queryKey: tenantKeys.list, exact: true })
    },
  })
}

export function useMembers(slug: string) {
  return useQuery({
    queryKey: tenantKeys.members(slug),
    queryFn: async () =>
      unwrap(await apiClient.get<ApiSuccess<TenantMember[]>>(`/tenants/${slug}/members`)),
  })
}

/** Pending invitations. Owner and admin only: anyone else gets a 403. */
export function useInvitations(slug: string) {
  return useQuery({
    queryKey: tenantKeys.invitations(slug),
    queryFn: async () =>
      unwrap(await apiClient.get<ApiSuccess<TenantInvitation[]>>(`/tenants/${slug}/invitations`)),
  })
}

/**
 * Answers 202 with `data: null` whether or not the address has an account,
 * so a success never says whether one exists. Refusals still differ: 409
 * `already_member` or `invitation_conflict`, 403 for a role the caller can't
 * grant, 422 for an invalid body.
 */
export function useInviteMember(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: InviteMemberInput) =>
      unwrap(await apiClient.post<ApiSuccess<null>>(`/tenants/${slug}/invitations`, input)),
    // A conflict means someone else's invite for this address just landed,
    // so the list on screen is stale; `already_member` changes nothing here.
    onSettled: (_data, error) =>
      !error || codeFrom(error) === INVITATION_CONFLICT
        ? queryClient.invalidateQueries({ queryKey: tenantKeys.invitations(slug) })
        : undefined,
  })
}

/** A new link and a fresh expiry; the old link stops working. */
export function useResendInvitation(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (invitationId: string) =>
      unwrap(
        await apiClient.post<ApiSuccess<null>>(
          `/tenants/${slug}/invitations/${invitationId}/resend`
        )
      ),
    // Settled, not success: a 404 means the row is no longer pending, so the
    // list on screen is stale either way.
    onSettled: () => queryClient.invalidateQueries({ queryKey: tenantKeys.invitations(slug) }),
  })
}

export function useRevokeInvitation(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (invitationId: string) =>
      unwrap(
        await apiClient.delete<ApiSuccess<null>>(`/tenants/${slug}/invitations/${invitationId}`)
      ),
    // Settled, for the same reason as resend.
    onSettled: () => queryClient.invalidateQueries({ queryKey: tenantKeys.invitations(slug) }),
  })
}

export function useUpdateMemberRole(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: MembershipRole }) =>
      unwrap(
        await apiClient.patch<ApiSuccess<TenantMembership>>(`/tenants/${slug}/members/${userId}`, {
          role,
        })
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: tenantKeys.members(slug) })
      // The caller may have changed their OWN role. `useMyRole` reads the
      // detail, and the list's role badge reads the list: refresh both, and
      // `exact` so the detail refresh does not refetch every tab's query.
      await queryClient.invalidateQueries({ queryKey: tenantKeys.detail(slug), exact: true })
      await queryClient.invalidateQueries({ queryKey: tenantKeys.list, exact: true })
    },
  })
}

export function useRemoveMember(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (userId: string) =>
      apiClient.delete<ApiSuccess<null>>(`/tenants/${slug}/members/${userId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: tenantKeys.members(slug) })
      // The caller may have removed THEMSELVES, in which case this tenant
      // is no longer theirs at all and the list must drop it.
      await queryClient.invalidateQueries({ queryKey: tenantKeys.list, exact: true })
    },
  })
}

export function useTenantSettings(slug: string) {
  return useQuery({
    queryKey: tenantKeys.settings(slug),
    queryFn: async () =>
      unwrap(await apiClient.get<ApiSuccess<TenantSettings>>(`/tenants/${slug}/settings`)),
  })
}

export function useUpdateTenantSettings(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateTenantSettingsInput) =>
      unwrap(await apiClient.patch<ApiSuccess<TenantSettings>>(`/tenants/${slug}/settings`, input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tenantKeys.settings(slug) }),
  })
}

/** How many owners a member list holds — the last-owner guard's input. */
export function ownerCount(members: TenantMember[] | undefined): number {
  return (members ?? []).filter((member) => member.membership.role === 'owner').length
}

/** "Ada Lovelace", or the email when the member has no name on file. */
export function memberName(member: TenantMember): string {
  const full = [member.user.firstName, member.user.lastName].filter(Boolean).join(' ').trim()
  return full || member.user.email
}
