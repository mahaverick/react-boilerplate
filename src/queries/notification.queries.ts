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
 * A page of the inbox. `nextCursor` is omitted, never null, when no further
 * page exists, which is what useInfiniteQuery reads as "no next page".
 */
export interface NotificationPage {
  notifications: Notification[]
  nextCursor?: string
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

/** The API's own default page size; its cap is 100. */
const PAGE_SIZE = 20

/** The inbox, newest first, a page at a time. */
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
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })
}

/** Every loaded page, flattened. The cache holds pages; callers want rows. */
export function flattenPages(data: InfiniteData<NotificationPage> | undefined): Notification[] {
  return data?.pages.flatMap((page) => page.notifications) ?? []
}

/**
 * How many loaded notifications are unread, derived from the cached pages
 * because the API has no unread-count endpoint. It counts what is loaded, not
 * a true total.
 */
export function unreadCount(data: InfiniteData<NotificationPage> | undefined): number {
  return flattenPages(data).filter((notification) => notification.readAt === null).length
}

/**
 * Rewrite every loaded page through `update`, and return the whole previous
 * cache entry, which `onError` restores: the row may sit on any loaded page.
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

/** Marks every notification read; the list refetches once the request settles. */
export function useMarkAllRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () =>
      unwrap(await apiClient.patch<ApiSuccess<{ count: number }>>('/notifications/read-all')),
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
