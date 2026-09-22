import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import type { ApiSuccess } from '@/types/api.types'

/**
 * One row of `GET /api/v1/notifications` — a whole `notifications` row, as
 * `NotificationRepository.list` returns it (`db.select()` with no projection).
 *
 * `body` is `text().notNull()` on the model, so it is `string`, never null.
 * `metadata` is nullable `jsonb` with no shape of its own — the server calls
 * it "opaque to this repository, never queried on" — so it stays `unknown`
 * values rather than being given a structure this client would then have to
 * keep in step with whatever a future producer writes.
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
 * What `GET /api/v1/notifications/stream` puts on a `notification` event's
 * `data:` line — NOT a list row. `toStreamPayload`
 * (notification-stream.controller.ts) narrows the row to exactly these six
 * fields, dropping `userId` (the connection is already scoped to one user)
 * and `metadata`. Typed separately so nothing reads `metadata` off a value
 * that never carries it.
 */
export interface NotificationStreamPayload {
  id: string
  type: string
  title: string
  body: string
  readAt: string | null
  createdAt: string
}

/**
 * A page of the inbox.
 *
 * `notifications`, not `items` — and `nextCursor` is OMITTED, not null, when
 * no further page exists: the repository builds the object conditionally for
 * its own `exactOptionalPropertyTypes`, so `undefined` is the only "no more
 * pages" value that ever reaches this client.
 */
export interface NotificationPage {
  notifications: Notification[]
  nextCursor?: string
}

/**
 * One notification type's resolved channel preferences — an entry of the
 * server's `PreferenceMatrix`, which always lists EVERY known type with
 * defaults already filled in, not just the ones the user has a row for.
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

export const notificationKeys = {
  list: ['notifications'] as const,
  preferences: ['notifications', 'preferences'] as const,
}

const PAGE_SIZE = 20 // the backend's own default; its hard cap is 100

export function useNotifications() {
  return useInfiniteQuery({
    queryKey: notificationKeys.list,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await apiClient.get<ApiSuccess<NotificationPage>>('/notifications', {
          params: { limit: PAGE_SIZE, cursor: pageParam },
        })
      ),
    // No `?? undefined`: see NotificationPage — the key is absent, never null,
    // so the value here is already `string | undefined`, which is exactly what
    // useInfiniteQuery reads as "there is no next page".
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })
}

/** Every loaded page, flattened. The cache holds pages; callers want rows. */
export function flattenPages(data: InfiniteData<NotificationPage> | undefined): Notification[] {
  return data?.pages.flatMap((page) => page.notifications) ?? []
}

/**
 * How many loaded notifications are unread.
 *
 * Derived from the pages already in the cache rather than fetched, because
 * this API exposes no unread-count endpoint (notification.routes.ts has
 * exactly list, mark-read, mark-all-read, delete and the two preference
 * routes). A user with more unread notifications than the loaded pages hold
 * therefore sees the count of what is loaded, not a true total.
 */
export function unreadCount(data: InfiniteData<NotificationPage> | undefined): number {
  return flattenPages(data).filter((notification) => notification.readAt === null).length
}

/**
 * Rewrite every loaded page through `update`, and hand back the snapshot that
 * was replaced so `onError` can put it straight back.
 *
 * Shared by mark-read and delete: both mutate rows that may sit on any loaded
 * page, and both need the *whole* previous cache entry as their rollback — not
 * just the page they touched — because react-query replaces the entry wholesale.
 */
function optimisticallyUpdatePages(
  queryClient: ReturnType<typeof useQueryClient>,
  update: (notifications: Notification[]) => Notification[]
): InfiniteData<NotificationPage> | undefined {
  const snapshot = queryClient.getQueryData<InfiniteData<NotificationPage>>(notificationKeys.list)
  queryClient.setQueryData<InfiniteData<NotificationPage>>(notificationKeys.list, (current) =>
    current === undefined
      ? current
      : {
          ...current,
          pages: current.pages.map((page) => ({
            ...page,
            notifications: update(page.notifications),
          })),
        }
  )
  return snapshot
}

export function useMarkRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(await apiClient.patch<ApiSuccess<Notification>>(`/notifications/${id}/read`)),
    onMutate: async (id) => {
      // An in-flight list refetch that started before this mutation would
      // otherwise land after it and overwrite the optimistic row.
      await queryClient.cancelQueries({ queryKey: notificationKeys.list })
      const readAt = new Date().toISOString()
      const snapshot = optimisticallyUpdatePages(queryClient, (notifications) =>
        notifications.map((notification) =>
          notification.id === id && notification.readAt === null
            ? { ...notification, readAt }
            : notification
        )
      )
      return { snapshot }
    },
    onError: (_error, _id, context) => {
      queryClient.setQueryData(notificationKeys.list, context?.snapshot)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.list }),
  })
}

export function useMarkAllRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () =>
      unwrap(await apiClient.patch<ApiSuccess<{ count: number }>>('/notifications/read-all')),
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.list }),
  })
}

export function useDeleteNotification() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => apiClient.delete<ApiSuccess<null>>(`/notifications/${id}`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.list })
      const snapshot = optimisticallyUpdatePages(queryClient, (notifications) =>
        notifications.filter((notification) => notification.id !== id)
      )
      return { snapshot }
    },
    onError: (_error, _id, context) => {
      queryClient.setQueryData(notificationKeys.list, context?.snapshot)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.list }),
  })
}

export function usePreferences() {
  return useQuery({
    queryKey: notificationKeys.preferences,
    queryFn: async () =>
      unwrap(await apiClient.get<ApiSuccess<PreferencesPayload>>('/notifications/preferences'))
        .preferences,
  })
}

/**
 * Upsert one type's channel preferences.
 *
 * The body is `{ preferences: [entry] }` — an ARRAY of whole entries, with
 * `min(1)` — not a flat `Record<string, boolean>`, and both channel booleans
 * travel together because `updatePreferencesSchema` requires both. Flipping
 * one switch therefore sends the other channel's current value alongside it.
 *
 * Every type is currently non-configurable server-side
 * (`CONFIGURABLE_NOTIFICATION_TYPES` filters both known types out), so this
 * call answers 400 with a per-field message today. That message is surfaced
 * verbatim rather than the client second-guessing it from a hardcoded copy of
 * the server's non-disableable list — which would be a second source of truth
 * that silently rots the day a configurable type ships.
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
