import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import type { MembershipRole } from '@/constants/roles'
import { PLATFORM_TENANT_SLUG } from '@/constants/routes'
import { apiClient, unwrap } from '@/http/client'
import { codeFrom, messageFrom, statusFrom } from '@/lib/api-error'
import { fullName } from '@/lib/format'
import { refreshProfile } from '@/queries/profile.queries'
import type {
  InviteMemberInput,
  NewTenantInput,
  UpdateTenantInput,
  UpdateTenantSettingsInput,
} from '@/schemas/tenant.schemas'
import { useAuthStore } from '@/states/auth.store'
import {
  INVITATION_CONFLICT,
  MEMBER_NOT_FOUND,
  MEMBER_NOT_FOUND_MESSAGE,
  type ApiSuccess,
  type TenantAccess,
  type TenantInvitation,
} from '@/types/api.types'

/**
 * A whole `tenants` row, as the API returns it: no projection, so every column
 * is on the wire, the soft-delete bookkeeping included.
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
 * One row of `GET /tenants/:slug/members`. `user` is a four-column projection
 * on the server, never the whole users row, so no `passwordHash`.
 */
export interface TenantMember {
  membership: TenantMembership
  user: {
    id: string
    email: string
    firstName: string | null
    lastName: string | null
    /**
     * False for a deactivated account. Only the platform tenant's list carries
     * it (express 2.1.0 or later); a missing value means active.
     */
    active?: boolean
  }
}

/** One row of `GET /tenants`: the tenant plus the caller's membership role in it. */
export interface TenantWithRole {
  tenant: Tenant
  role: MembershipRole
  /** The platform tenant's row, which the switcher leaves out and the user menu links instead. */
  isPlatform: boolean
}

/**
 * `GET /tenants/:slug`: the row plus the caller's effective role there and
 * how they reached it. A member's role wins over any platform role, so
 * `access: 'platform'` only appears in a tenant the caller is not in.
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
 * The tenant query keys. `['tenants']` is a prefix of every other key, so
 * invalidating it without `exact: true` refetches every open detail, member
 * and settings query too. Each mutation invalidates the narrowest key that
 * changed, with `exact: true` when it means the list alone.
 */
export const tenantKeys = {
  list: ['tenants'] as const,
  detail: (slug: string) => ['tenants', slug] as const,
  members: (slug: string) => ['tenants', slug, 'members'] as const,
  settings: (slug: string) => ['tenants', slug, 'settings'] as const,
  invitations: (slug: string) => ['tenants', slug, 'invitations'] as const,
  /** Under the tenant prefix, so a self-removal or an invitation accept drops it with the rest. */
  onboarding: (slug: string) => ['tenants', slug, 'onboarding'] as const,
}

export function useTenants() {
  return useQuery({
    queryKey: tenantKeys.list,
    queryFn: async () => unwrap(await apiClient.get<ApiSuccess<TenantWithRole[]>>('/tenants')),
  })
}

/**
 * One tenant, where a 404 resolves to `null` rather than rejecting.
 * `GET /tenants/:slug` answers the same 404 for "no such tenant" and "no
 * access", and the route renders both as one not-found panel. A rejection
 * would be retried (the query client's `retry: 1`), refetched on mount, and
 * thrown by `ensureQueryData` in `$slug.tsx`'s loader into the error boundary.
 * Every other failure still rejects and reaches the boundary. A 404 also
 * invalidates the tenant list (exact key only, so the detail is not refetched),
 * because the page reads the list to tell a suspended tenant from a missing one.
 */
export function tenantQueryOptions(slug: string) {
  return queryOptions({
    queryKey: tenantKeys.detail(slug),
    queryFn: async ({ client }) => {
      try {
        return unwrap(await apiClient.get<ApiSuccess<TenantDetail>>(`/tenants/${slug}`))
      } catch (error) {
        if (statusFrom(error) === 404) {
          // A suspended tenant answers 404 too; the list is what tells it apart, and may be stale.
          void client.invalidateQueries({ queryKey: tenantKeys.list, exact: true })
          return null
        }
        throw error
      }
    },
  })
}

export function useTenant(slug: string) {
  return useQuery(tenantQueryOptions(slug))
}

/**
 * The caller's effective role in one tenant, and how they reached it, read off
 * `GET /tenants/:slug` rather than the tenant list: staff visiting a tenant
 * they are not in have no list row, and the detail carries the role the API
 * enforces. Every role-gated control reads this.
 *
 * Three states. `isPending` is not known yet (render a skeleton). `isError` is
 * a failed refetch with the cached row still in place (say so and offer a
 * retry); a failed first load is caught by `$slug.tsx`'s error boundary
 * instead. A `role` of `undefined` after a successful load is a 404, which the
 * layout has already turned into its not-found panel.
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tenantKeys.list, exact: true }),
  })
}

/** Updates the tenant, refreshing its detail and the list, which carries the name for the switcher. */
export function useUpdateTenant(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateTenantInput) =>
      unwrap(await apiClient.patch<ApiSuccess<Tenant>>(`/tenants/${slug}`, input)),
    onSuccess: async () => {
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
 * grant, 400 for an invalid body.
 */
export function useInviteMember(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: InviteMemberInput) =>
      unwrap(await apiClient.post<ApiSuccess<null>>(`/tenants/${slug}/invitations`, input)),
    /**
     * A conflict means another invite for this address just landed, so the list
     * is stale; either invite completes the invite-a-teammate onboarding step.
     */
    onSettled: async (_data, error) => {
      if (error && codeFrom(error) !== INVITATION_CONFLICT) return
      await queryClient.invalidateQueries({ queryKey: tenantKeys.invitations(slug) })
      await queryClient.invalidateQueries({ queryKey: tenantKeys.onboarding(slug) })
    },
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
    /** Settled, not success: a 404 means the row is no longer pending, so the list is stale. */
    onSettled: () => queryClient.invalidateQueries({ queryKey: tenantKeys.invitations(slug) }),
  })
}

/** Revokes a pending invitation; its link stops working. */
export function useRevokeInvitation(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (invitationId: string) =>
      unwrap(
        await apiClient.delete<ApiSuccess<null>>(`/tenants/${slug}/invitations/${invitationId}`)
      ),
    /** Settled, not success: a 404 means the row is no longer pending, so the list is stale. */
    onSettled: () => queryClient.invalidateQueries({ queryKey: tenantKeys.invitations(slug) }),
  })
}

/**
 * Whether a role change or removal found its target no longer a member: the
 * `member_not_found` code first, then, from an API older than 2.1.0 that sends
 * no code, the bare 404 message.
 * @param error - The failed request's error.
 * @returns `true` when the member is gone.
 */
export function isMemberNotFound(error: unknown): boolean {
  const code = codeFrom(error)
  if (code !== undefined) return code === MEMBER_NOT_FOUND
  return statusFrom(error) === 404 && messageFrom(error) === MEMBER_NOT_FOUND_MESSAGE
}

/**
 * Changes a member's role. The caller may have changed their own, which the
 * detail and the list both carry, so both refresh; a self change in the
 * platform tenant also refreshes the stored user's platformRole. A target
 * already gone (`isMemberNotFound`) refreshes the member list.
 */
export function useUpdateMemberRole(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: MembershipRole }) =>
      unwrap(
        await apiClient.patch<ApiSuccess<TenantMembership>>(`/tenants/${slug}/members/${userId}`, {
          role,
        })
      ),
    onSuccess: async (_data, { userId }) => {
      await queryClient.invalidateQueries({ queryKey: tenantKeys.members(slug) })
      await queryClient.invalidateQueries({ queryKey: tenantKeys.detail(slug), exact: true })
      await queryClient.invalidateQueries({ queryKey: tenantKeys.list, exact: true })
      if (slug === PLATFORM_TENANT_SLUG && userId === useAuthStore.getState().user?.id) {
        await refreshProfile(queryClient)
      }
    },
    onError: async (error) => {
      if (isMemberNotFound(error)) {
        await queryClient.invalidateQueries({ queryKey: tenantKeys.members(slug) })
      }
    },
  })
}

/**
 * Leaves a tenant: `DELETE /tenants/:slug/membership`, open to every role but
 * the tenant's last owner (409 `LAST_OWNER`). On success, or on a 404 (the
 * membership was already gone), it refetches the tenant list, which the
 * switcher reads, and leaving the platform tenant refreshes the stored user's
 * platformRole. A 409 refetches the member list, since another owner changed
 * under the page. The tenant's own cache is dropped by the page with
 * `dropTenantCache` once it has left the tenant's routes: dropped any earlier,
 * a still-mounted observer would refetch it.
 */
export function useLeaveTenant(slug: string) {
  const queryClient = useQueryClient()
  const afterLeaving = async () => {
    await queryClient.invalidateQueries({ queryKey: tenantKeys.list, exact: true })
    if (slug === PLATFORM_TENANT_SLUG) await refreshProfile(queryClient)
  }
  return useMutation({
    mutationFn: async () => apiClient.delete<ApiSuccess<null>>(`/tenants/${slug}/membership`),
    onSuccess: afterLeaving,
    onError: async (error) => {
      const status = statusFrom(error)
      if (status === 404) await afterLeaving()
      else if (status === 409) {
        await queryClient.invalidateQueries({ queryKey: tenantKeys.members(slug) })
      }
    },
  })
}

/**
 * Drops a tenant's whole cache prefix (detail, members, settings,
 * invitations and the rest), for a tenant the caller can no longer read.
 * Call it after navigating away from the tenant's routes, so no mounted
 * query refetches what it drops.
 * @param queryClient - The app's query client.
 * @param slug - The tenant left.
 */
export function dropTenantCache(queryClient: QueryClient, slug: string): void {
  queryClient.removeQueries({ queryKey: tenantKeys.detail(slug) })
}

/**
 * Removes another member, then refetches the member list and the tenant
 * list; a target already gone (`isMemberNotFound`) refetches the member list
 * too. Leaving, which removes yourself, is `useLeaveTenant`.
 */
export function useRemoveMember(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (userId: string) =>
      apiClient.delete<ApiSuccess<null>>(`/tenants/${slug}/members/${userId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: tenantKeys.members(slug) })
      await queryClient.invalidateQueries({ queryKey: tenantKeys.list, exact: true })
    },
    onError: async (error) => {
      if (isMemberNotFound(error)) {
        await queryClient.invalidateQueries({ queryKey: tenantKeys.members(slug) })
      }
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
    /** A saved change completes the configure-settings onboarding step, so its card refetches too. */
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: tenantKeys.settings(slug) })
      await queryClient.invalidateQueries({ queryKey: tenantKeys.onboarding(slug) })
    },
  })
}

/**
 * How many owners besides `userId` the API counts toward the last-owner rule:
 * every listed owner on a customer tenant, deactivated or not, and on the
 * platform tenant only those whose account is active (a missing `active`
 * counts as active), as express's `countOwners` and `countActiveOwners` do.
 * @param members - The member list.
 * @param userId - The owner acting on their own membership.
 * @param isPlatform - Whether this is the platform tenant.
 * @returns The other owners that count.
 */
export function otherOwnerCount(
  members: TenantMember[] | undefined,
  userId: string | undefined,
  isPlatform: boolean
): number {
  return (members ?? []).filter(
    (member) =>
      member.membership.role === 'owner' &&
      member.user.id !== userId &&
      (!isPlatform || member.user.active !== false)
  ).length
}

/** "Ada Lovelace", or the email when the member has no name on file. */
export function memberName(member: TenantMember): string {
  return fullName(member.user) ?? member.user.email
}
