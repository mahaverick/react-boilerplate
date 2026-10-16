import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import { listQueryOptions } from '@/queries/list.queries'
import type { ApiSuccess } from '@/types/api.types'
import type { ListPage, ListRequest } from '@/types/list.types'

/**
 * One row of `GET /api/v1/notifications`: a `notifications` row without its
 * internal columns. `body` is NOT NULL. `metadata` is nullable `jsonb` with no
 * shape of its own on the server, so its values stay `unknown` here.
 */
export interface Notification {
  id: string
  userId: string
  type: string
  title: string
  body: string
  metadata: Record<string, unknown> | null
  /** ISO timestamp, or null while unread. Never cleared back to null. */
  readAt: string | null
  createdAt: string
}

/**
 * One notification type's resolved channel preferences: an entry of the
 * server's `PreferenceMatrix`, which lists each type the caller can see once,
 * with both channels on for a type the user has no row for.
 */
export interface NotificationPreference {
  notificationType: string
  emailEnabled: boolean
  inAppEnabled: boolean
}

/** Both preference endpoints wrap the matrix in a `preferences` key. */
interface PreferencesPayload {
  preferences: NotificationPreference[]
}

/**
 * The notification query keys. `list` and `preferences` both sit under `all`,
 * so each list operation names `list`: it is not a prefix of `preferences`, so
 * invalidating or cancelling the list never reaches the preferences query.
 */
export const notificationKeys = {
  all: ['notifications'] as const,
  list: ['notifications', 'list'] as const,
  preferences: ['notifications', 'preferences'] as const,
}

/** How many notifications the bell previews. */
export const BELL_PREVIEW_LIMIT = 5

/**
 * One page of the inbox (`GET /notifications`), under `notificationKeys.list`,
 * which the stream invalidates.
 * @param request - From `listRequest(notificationsList, …)`, or the bell's.
 * @param options - `total: false` for a read that never uses the total (the bell's preview).
 * @param options.total - Whether the first page asks for the capped total.
 */
export function notificationsListOptions(request: ListRequest, options: { total?: boolean } = {}) {
  return listQueryOptions<Notification>({
    key: notificationKeys.list,
    path: '/notifications',
    request,
    ...options,
  })
}

/**
 * How many notifications are unread: the capped total of the unread view,
 * read one row at a time. The query, so a reader can tell a failed count
 * from one still loading; its `data` is `undefined` until it lands.
 */
export function useUnreadCount() {
  return useQuery({
    ...notificationsListOptions({ unread: true, limit: 1 }),
    select: (page: ListPage<Notification>) => page.total,
  })
}

/** Every cached inbox page, before a write rewrote them, so `onError` can put them back. */
type PageSnapshot = Array<[QueryKey, ListPage<Notification> | undefined]>

/** One cached inbox page's rewrite; `request` is the one that page was read with. */
type PageEdit = (page: ListPage<Notification>, request: ListRequest) => ListPage<Notification>

/**
 * Rewrites every cached inbox page through `edit` and returns them as they
 * were: the row may be on any page, in any filtered view.
 * @param queryClient - The app's query client.
 * @param edit - The new page for a cached page and its request.
 */
function rewritePages(queryClient: QueryClient, edit: PageEdit): PageSnapshot {
  const snapshot = queryClient.getQueriesData<ListPage<Notification>>({
    queryKey: notificationKeys.list,
  })
  for (const [key, page] of snapshot) {
    if (page !== undefined) queryClient.setQueryData(key, edit(page, key[3] as ListRequest))
  }
  return snapshot
}

/**
 * Whether a cached row is unread, in any cached page.
 * @param snapshot - The pages before the write.
 * @param id - The notification.
 */
function wasUnread(snapshot: PageSnapshot, id: string): boolean {
  return snapshot.some(([, page]) =>
    page?.items.some((row) => row.id === id && row.readAt === null)
  )
}

/**
 * The unread views' count and rows after one unread row left them: the row is
 * dropped, and a total that is exact (present, not at the cap) goes down by one.
 * @param page - A cached page.
 * @param request - Its request.
 * @param id - The notification that left the unread state.
 * @param countDown - Whether it was unread, so the count falls.
 */
function leaveUnreadViews(
  page: ListPage<Notification>,
  request: ListRequest,
  id: string,
  countDown: boolean
): ListPage<Notification> {
  if (request.unread !== true) return page
  const total = page.total
  return {
    ...page,
    items: page.items.filter((row) => row.id !== id),
    ...(countDown && total && !total.capped
      ? { total: { ...total, count: Math.max(0, total.count - 1) } }
      : {}),
  }
}

/**
 * Puts back the pages `rewritePages` returned.
 * @param queryClient - The app's query client.
 * @param snapshot - What `rewritePages` returned.
 */
function restorePages(queryClient: QueryClient, snapshot: PageSnapshot | undefined): void {
  for (const [key, page] of snapshot ?? []) queryClient.setQueryData(key, page)
}

/** Marks one notification read. The row shows read at once and is restored if the request fails. */
export function useMarkRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(await apiClient.patch<ApiSuccess<Notification>>(`/notifications/${id}/read`)),
    onMutate: async (id) => {
      // Cancelled so an earlier in-flight refetch cannot land after this and overwrite the row.
      await queryClient.cancelQueries({ queryKey: notificationKeys.list })
      const readAt = new Date().toISOString()
      const snapshot = queryClient.getQueriesData<ListPage<Notification>>({
        queryKey: notificationKeys.list,
      })
      const countDown = wasUnread(snapshot, id)
      rewritePages(queryClient, (page, request) =>
        leaveUnreadViews(
          {
            ...page,
            items: page.items.map((notification) =>
              notification.id === id && notification.readAt === null
                ? { ...notification, readAt }
                : notification
            ),
          },
          request,
          id,
          countDown
        )
      )
      return { snapshot }
    },
    onError: (_error, _id, context) => {
      restorePages(queryClient, context?.snapshot)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.list }),
  })
}

/** Marks every notification read. The rows show read and the unread views empty at once, restored if the request fails; the list refetches once it settles. */
export function useMarkAllRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () =>
      unwrap(await apiClient.patch<ApiSuccess<{ count: number }>>('/notifications/read-all')),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.list })
      const readAt = new Date().toISOString()
      const snapshot = rewritePages(queryClient, (page, request) =>
        request.unread === true
          ? { ...page, items: [], ...(page.total ? { total: { count: 0, capped: false } } : {}) }
          : {
              ...page,
              items: page.items.map((row) => (row.readAt === null ? { ...row, readAt } : row)),
            }
      )
      return { snapshot }
    },
    onError: (_error, _vars, context) => {
      restorePages(queryClient, context?.snapshot)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.list }),
  })
}

/** Deletes one notification. The row leaves the list at once and returns if the request fails. */
export function useDeleteNotification() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => apiClient.delete<ApiSuccess<null>>(`/notifications/${id}`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.list })
      const snapshot = queryClient.getQueriesData<ListPage<Notification>>({
        queryKey: notificationKeys.list,
      })
      const countDown = wasUnread(snapshot, id)
      rewritePages(queryClient, (page, request) => {
        const withoutRow = { ...page, items: page.items.filter((row) => row.id !== id) }
        return request.unread === true
          ? leaveUnreadViews(withoutRow, request, id, countDown)
          : withoutRow
      })
      return { snapshot }
    },
    onError: (_error, _id, context) => {
      restorePages(queryClient, context?.snapshot)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.list }),
  })
}

/** The caller's channel preferences, one entry per notification type they can see. */
export function usePreferences() {
  return useQuery({
    queryKey: notificationKeys.preferences,
    queryFn: async () =>
      unwrap(await apiClient.get<ApiSuccess<PreferencesPayload>>('/notifications/preferences'))
        .preferences,
  })
}

/**
 * Upserts one type's channel preferences. The body is `{ preferences: [entry] }`,
 * an array of whole entries, with both channel booleans, as the API requires.
 * Any visible type may switch `inAppEnabled` either way; `emailEnabled` must be
 * `true`, since `false` is a 400 (email can never be turned off). The preferences
 * card's in-app switch is the caller. There is no optimistic write: the matrix
 * is refetched when the request settles, success or failure.
 */
export function useUpdatePreferences() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: NotificationPreference) =>
      unwrap(
        await apiClient.put<ApiSuccess<PreferencesPayload>>('/notifications/preferences', {
          preferences: [input],
        })
      ).preferences,
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.preferences }),
  })
}
