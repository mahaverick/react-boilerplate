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
 * One row of `GET /api/v1/notifications`: a whole `notifications` row, with no
 * projection. `body` is NOT NULL. `metadata` is nullable `jsonb` with no shape
 * of its own on the server, so its values stay `unknown` here.
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
 * server's `PreferenceMatrix`, which lists every known type once, with
 * defaults filled in for types the user has no row for.
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
 * The list and the preferences share the `all` prefix, so each list
 * operation names `list`. `list` is not a prefix of `preferences`, so a list
 * invalidation or cancel never reaches the preferences query.
 */
export const notificationKeys = {
  all: ['notifications'] as const,
  list: ['notifications', 'list'] as const,
  preferences: ['notifications', 'preferences'] as const,
}

/** The API's own default page size; its cap is 100. */
const PAGE_SIZE = 20

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
 * Upsert one type's channel preferences. The body is `{ preferences: [entry] }`,
 * an array of whole entries, with both channel booleans, as the API requires.
 *
 * Unused by the UI: the API's `CONFIGURABLE_NOTIFICATION_TYPES` (every type
 * minus those whose email may never be disabled) is empty, so this answers
 * 400 for every type and the preferences card renders read-only. When a
 * disableable type exists, `pages/_app/notifications.tsx` can offer the
 * control with this mutation as it is.
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
