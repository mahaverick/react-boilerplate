import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { MEMBERSHIP_ROLES } from '@/constants/membership-roles'
import type { MembershipRole } from '@/constants/roles'
import { PLATFORM_TENANT_SLUG } from '@/constants/routes'
import { apiClient, unwrap } from '@/http/client'
import { codeFrom, messageFrom, statusFrom } from '@/lib/api-error'
import { fullName } from '@/lib/format'
import { analyticsKey } from '@/observability/telemetry'
import { listQueryOptions } from '@/queries/list.queries'
import { refreshProfile } from '@/queries/profile.queries'
import { defineList, listFilter } from '@/schemas/list.schemas'
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
import type { ListPage, ListRequest } from '@/types/list.types'

/**
 * A `tenants` row as the API returns it: every column but the onboarding
 * bookkeeping, the soft-delete columns included.
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
 * One row of `GET /tenants/:slug/members`. `user` is a projection of the users
 * row (id, email and names, plus `active` on the platform tenant), so no
 * `passwordHash`.
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
  /** When the caller joined: their membership's `createdAt`. */
  joinedAt: string
  /** The platform tenant's row, which the tenant switcher leaves out: staff reach it from the user menu. */
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
 * and settings query too. A mutation that means the list alone passes
 * `exact: true`.
 */
export const tenantKeys = {
  list: ['tenants'] as const,
  /** Every page of the Tenants list. A slug never starts with `_`, so no tenant's keys share it. */
  pages: ['tenants', '_pages'] as const,
  detail: (slug: string) => ['tenants', slug] as const,
  members: (slug: string) => ['tenants', slug, 'members'] as const,
  settings: (slug: string) => ['tenants', slug, 'settings'] as const,
  invitations: (slug: string) => ['tenants', slug, 'invitations'] as const,
  /** Under the tenant prefix, so a self-removal or an invitation accept drops it with the rest. */
  onboarding: (slug: string) => ['tenants', slug, 'onboarding'] as const,
}

/** Whether the user may work in a listed tenant: not the platform tenant, and not suspended. */
export function isEligibleTenant(entry: TenantWithRole): boolean {
  return !entry.isPlatform && entry.tenant.lifecycleState !== 'suspended'
}

/** How many memberships one request asks for: the API's most. */
export const MEMBERSHIPS_PAGE_LIMIT = 100

/** The most pages `readMemberships` follows: 5,000 memberships, far past any account. */
const MAX_MEMBERSHIP_PAGES = 50

/**
 * Every membership, by name: one `GET /tenants` page, then the next until the
 * API says there is none. A cursor the API repeats, or more than
 * `MAX_MEMBERSHIP_PAGES` pages, is a fault and rejects, so the read never
 * loops. A tenant that moved across a page boundary between two reads is
 * listed once.
 * @returns The rows of every page, the first of any repeated tenant kept.
 */
async function readMemberships(): Promise<TenantWithRole[]> {
  const rows = new Map<string, TenantWithRole>()
  const sent = new Set<string>()
  let cursor: string | undefined
  for (let pages = 0; pages < MAX_MEMBERSHIP_PAGES; pages += 1) {
    const { items, page } = unwrap(
      await apiClient.get<ApiSuccess<ListPage<TenantWithRole>>>('/tenants', {
        params: { limit: MEMBERSHIPS_PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }) },
      })
    )
    for (const item of items) if (!rows.has(item.tenant.id)) rows.set(item.tenant.id, item)
    if (!page.hasNext || page.nextCursor === null) return [...rows.values()]
    if (sent.has(page.nextCursor)) throw new Error('GET /tenants repeated a cursor.')
    sent.add(page.nextCursor)
    cursor = page.nextCursor
  }
  throw new Error(`GET /tenants went past ${MAX_MEMBERSHIP_PAGES} pages.`)
}

/**
 * The tenant list's query: every tenant the caller is a member of, by name,
 * each with their role in it, read a page of `MEMBERSHIPS_PAGE_LIMIT` at a
 * time, so the guard and the switcher see them all. Shared by `useTenants`
 * and `_app`'s guard, which reads the same cached list to resolve the URL's
 * `?tenant`.
 */
export function tenantsQueryOptions() {
  return queryOptions({
    queryKey: tenantKeys.list,
    queryFn: () => readMemberships(),
  })
}

/** The Tenants page's URL contract: by name, or newest membership first, filtered by role. */
export const myTenantsList = defineList({
  sorts: ['name', '-joined'],
  filters: { role: listFilter(MEMBERSHIP_ROLES) },
  table: analyticsKey('tenants'),
})

/**
 * One page of the caller's tenants (`GET /tenants`), for the Tenants table.
 * @param request - From `listRequest(myTenantsList, …)`.
 * @returns Query options for `useListQuery`.
 */
export function myTenantsListOptions(request: ListRequest) {
  return listQueryOptions<TenantWithRole>({ key: tenantKeys.pages, path: '/tenants', request })
}

/**
 * Refetches the caller's tenant list and every page of the Tenants list,
 * leaving each tenant's own queries alone.
 * @param queryClient - The app's query client.
 */
export async function invalidateTenantList(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: tenantKeys.list, exact: true }),
    queryClient.invalidateQueries({ queryKey: tenantKeys.pages }),
  ])
}

/** Every tenant the caller is a member of, each with their role in it. */
export function useTenants() {
  return useQuery(tenantsQueryOptions())
}

/**
 * One tenant, where a 404 resolves to `null` rather than rejecting.
 * `GET /tenants/:slug` answers the same 404 for "no such tenant" and "no
 * access", and the route renders both as one not-found panel. A rejection
 * would be retried (the query client's `retry: 1`), refetched on mount, and
 * shown as the gate's load-error panel. Every other failure still rejects and
 * reaches that panel (`TenantGate`). A 404 also
 * invalidates the tenant list (exact key only, so the detail is not
 * refetched), because the page reads the list to tell a suspended tenant from
 * a missing one.
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
          void invalidateTenantList(client)
          return null
        }
        throw error
      }
    },
  })
}

/** One tenant's detail, with the caller's role and access; `null` for a 404. */
export function useTenant(slug: string) {
  return useQuery(tenantQueryOptions(slug))
}

/**
 * The caller's effective role in one tenant, and how they reached it, read off
 * `GET /tenants/:slug` rather than the tenant list: staff visiting a tenant
 * they are not in have no list row, and the detail carries the role the API
 * enforces. Role-gated controls read this.
 *
 * Three states. `isPending` is not known yet (render a skeleton). `isError` is
 * a failed refetch with the cached row still in place (say so and offer a
 * retry); a failed first load is the layout gate's load-error panel
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

/** Creates a tenant with the caller as its owner, then refetches the tenant list. */
export function useCreateTenant() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: NewTenantInput) =>
      unwrap(await apiClient.post<ApiSuccess<Tenant>>('/tenants', input)),
    onSuccess: () => invalidateTenantList(queryClient),
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
      await invalidateTenantList(queryClient)
    },
  })
}

/** Pending invitations' URL contract on the members page: its keys are prefixed, since the member list shares the route. */
export const invitationsList = defineList({
  sorts: ['-created', 'email'],
  filters: { role: listFilter(MEMBERSHIP_ROLES) },
  table: analyticsKey('invitations'),
  prefix: 'invitations',
})

/** The members page's URL contract: the member list's, with the invitations list's keys kept. */
export const membersList = defineList({
  sorts: ['name', 'email', 'role', '-joined'],
  filters: { role: listFilter(MEMBERSHIP_ROLES) },
  table: analyticsKey('members'),
  also: [invitationsList],
})

/**
 * One page of a tenant's members.
 * @param slug - The tenant.
 * @param request - From `listRequest(membersList, …)`.
 */
export function membersListOptions(slug: string, request: ListRequest) {
  return listQueryOptions<TenantMember>({
    key: tenantKeys.members(slug),
    path: `/tenants/${slug}/members`,
    request,
  })
}

/**
 * A tenant's owners (the first 100), for the last-owner rule: a page of the
 * member list may not hold them all. Its own key under the members prefix,
 * apart from the table's pages, so every member write refreshes it and no
 * table view ever reads it.
 * @param slug - The tenant.
 */
export function ownersQueryOptions(slug: string) {
  return listQueryOptions<TenantMember>({
    key: [...tenantKeys.members(slug), 'owners'],
    path: `/tenants/${slug}/members`,
    request: { role: 'owner', limit: 100 },
  })
}

/**
 * How many owners besides `userId` the API counts toward the last-owner rule,
 * from the owners read: `otherOwnerCount` over its rows, plus one when the
 * read says more owners follow (`page.hasNext`), since another owner then
 * certainly remains. 0 while the read has not landed, which keeps the last
 * owner's own controls locked until it does.
 * @param owners - The owners read's page, if it has landed.
 * @param userId - The owner acting on their own membership.
 * @param isPlatform - Whether this is the platform tenant (only active owners count there).
 */
export function ownersBesides(
  owners: ListPage<TenantMember> | undefined,
  userId: string | undefined,
  isPlatform: boolean
): number {
  if (owners === undefined) return 0
  return otherOwnerCount(owners.items, userId, isPlatform) + (owners.page.hasNext ? 1 : 0)
}

/**
 * One page of a tenant's pending invitations. Owner and admin only.
 * @param slug - The tenant.
 * @param request - From `listRequest(invitationsList, …)`.
 */
export function invitationsListOptions(slug: string, request: ListRequest) {
  return listQueryOptions<TenantInvitation>({
    key: tenantKeys.invitations(slug),
    path: `/tenants/${slug}/invitations`,
    request,
  })
}

/** A tenant's first hundred members by name, for pickers such as the activity actor filter. */
export function useMembers(slug: string) {
  return useQuery({
    ...membersListOptions(slug, { limit: 100 }),
    select: (page: ListPage<TenantMember>) => page.items,
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

/** Resends a pending invitation with a new link and a fresh expiry; the old link stops working. */
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
      await invalidateTenantList(queryClient)
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
  /** Refetches the tenant list, and the stored user's platformRole when the platform tenant was left. */
  const afterLeaving = async () => {
    await invalidateTenantList(queryClient)
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
      await invalidateTenantList(queryClient)
    },
    onError: async (error) => {
      if (isMemberNotFound(error)) {
        await queryClient.invalidateQueries({ queryKey: tenantKeys.members(slug) })
      }
    },
  })
}

/** A tenant's settings. Anyone who can open the tenant may read them; saving is limited to owners and admins. */
export function useTenantSettings(slug: string) {
  return useQuery({
    queryKey: tenantKeys.settings(slug),
    queryFn: async () =>
      unwrap(await apiClient.get<ApiSuccess<TenantSettings>>(`/tenants/${slug}/settings`)),
  })
}

/** Saves the fields of a tenant's settings it is given, then refetches the settings. */
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
