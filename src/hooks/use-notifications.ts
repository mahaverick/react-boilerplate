import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { API_PREFIX } from '@/constants/routes'
import { ensureSession, isAuthVerdict, redirectToLogin } from '@/http/session'
import { parseSseStream } from '@/http/sse'
import { invalidateBilling } from '@/queries/billing.queries'
import { notificationKeys } from '@/queries/notification.queries'
import { useAuthStore } from '@/states/auth.store'
import { usePasskeySetupStore } from '@/states/passkey-setup.store'
import type { ApiErrorBody } from '@/types/api.types'
import { PASSKEY_SETUP_REQUIRED } from '@/types/passkey.types'

const INITIAL_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000

/**
 * The longest a server's `Retry-After` may hold a reconnect off, so a wrong
 * header (a far-future date) cannot park the stream for good.
 */
const MAX_RETRY_AFTER_MS = 5 * 60_000

/**
 * The most a `Retry-After` wait is stretched by, as a fraction of it, so the
 * tabs a full server refused together do not all return in the same second.
 */
const RETRY_AFTER_JITTER = 0.2

/**
 * A connect the server answered with a non-ok status, and the wait its
 * `Retry-After` asked for, if any.
 */
class StreamRefusedError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | null
  ) {
    super(`stream failed: ${status}`)
  }
}

/**
 * Reads a `Retry-After` header, in delay seconds or as an HTTP date.
 * @param value - The header's value, or null when absent.
 * @returns The wait in milliseconds, at most `MAX_RETRY_AFTER_MS`, or null when absent or unreadable.
 */
function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null
  const trimmed = value.trim()
  const ms = /^\d+$/.test(trimmed) ? Number(trimmed) * 1_000 : Date.parse(trimmed) - Date.now()
  if (Number.isNaN(ms)) return null
  return Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS)
}

/**
 * The event name the API writes on each notification frame
 * (`id: <id>\nevent: notification\ndata: <json>`). A mismatch fails silently:
 * the inbox never updates.
 */
const NOTIFICATION_EVENT = 'notification'

/**
 * The event name the API writes when a tenant's plan or entitlements change
 * (`event: entitlements_changed\ndata: {"tenantId","slug"}`). The frame has no
 * `id:` line and is never replayed, so it is not a notification: it moves no
 * backoff and no `Last-Event-ID`.
 */
const ENTITLEMENTS_EVENT = 'entitlements_changed'

/** The cached tenant query suffixes that mark a tenant as one whose billing a reconnect must refetch. */
const BILLING_KEY_PARTS = new Set(['entitlements', 'billing', 'upgrade-requests'])

/**
 * Reads the slug off an `entitlements_changed` frame's data.
 * @param data - The frame's raw `data:` text.
 * @returns The slug, or null when the data is not JSON or has no string slug.
 */
function parseEntitlementsSlug(data: string): string | null {
  try {
    const parsed: unknown = JSON.parse(data)
    if (typeof parsed !== 'object' || parsed === null || !('slug' in parsed)) return null
    return typeof parsed.slug === 'string' && parsed.slug !== '' ? parsed.slug : null
  } catch {
    return null
  }
}

/**
 * Keep the notification list in step with the server's SSE stream, for as
 * long as there is a session.
 *
 * The stream is read with `fetch`, so the access token travels in a header,
 * never the URL (browser history, a Referer, request-line logs). Each
 * reconnect sends the last id seen as `Last-Event-ID` so the server can replay
 * what was missed, and every accepted connect refetches the list, which covers
 * the first connect (no id, no replay). `fetch` has no built-in reconnect, so
 * every reconnect is `scheduleReconnect`'s, under a doubling backoff.
 *
 * The backoff resets only when a notification arrives, never on a successful
 * connect: a backend that accepts and then closes with no frames would
 * otherwise pin the retry at one second, and each retry calls ensureSession(),
 * which rotates the refresh cookie. It lives in a ref so a token rotation
 * re-running the effect cannot reset it either.
 *
 * When a reconnect's refresh fails, an auth verdict sends the user to /login
 * (nothing else would move a tab that is sitting still), and any other
 * failure (a deploy's 502, a 429, an unreachable API) keeps retrying.
 *
 * A connect refused with 403 `PASSKEY_SETUP_REQUIRED` (required mode switched on
 * mid-session) raises the setup flag and does not reconnect; the effect stays
 * down while the flag is set and reconnects when setup ends.
 *
 * A connect the server refused with anything but a 401 (a 503 at its stream
 * capacity, a 429 over the per-user cap) says nothing about the session, so
 * it reconnects with the same token and no refresh. It waits the backoff or
 * the response's `Retry-After`, whichever is longer, plus jitter on a
 * `Retry-After` wait.
 *
 * Mount this once, in `AppLayout`'s body, never in the bell or the page: two
 * mounts open two connections, and anything inside `Sidebar` unmounts below
 * 768px, where it becomes a `Sheet`.
 */
export function useNotificationStream(): void {
  const accessToken = useAuthStore((s) => s.accessToken)
  const setupRequired = usePasskeySetupStore((s) => s.required)
  const queryClient = useQueryClient()
  const backoffRef = useRef(INITIAL_BACKOFF_MS)
  const lastEventId = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!accessToken || setupRequired) return

    let abort: AbortController | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    /** Marks the cached notification list stale so it refetches. */
    const refetchList = () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.list })
    }

    /**
     * Refetches the billing keys of every tenant in the cache. Frames carry no id and are
     * never replayed, so a change made while the stream was down is only caught here.
     */
    const refetchCachedBilling = () => {
      const slugs = new Set<string>()
      for (const { queryKey } of queryClient.getQueryCache().getAll()) {
        const [root, slug, part] = queryKey
        if (root === 'tenants' && typeof slug === 'string' && !slug.startsWith('_')) {
          if (typeof part === 'string' && BILLING_KEY_PARTS.has(part)) slugs.add(slug)
        }
      }
      for (const slug of slugs) void invalidateBilling(queryClient, slug)
    }

    /** Handles one notification frame: the stream is healthy, so the backoff resets and the list refetches. */
    const onNotification = () => {
      backoffRef.current = INITIAL_BACKOFF_MS
      refetchList()
    }

    /**
     * Queues the next connect after the backoff (and a refusal's `Retry-After`), doubling the backoff.
     * @param token - The access token the dropped connection used.
     * @param refusal - The server's refusal, when the connect was refused rather than dropped.
     */
    const scheduleReconnect = (token: string, refusal?: StreamRefusedError) => {
      if (cancelled) return
      const backoff = backoffRef.current
      backoffRef.current = Math.min(backoff * 2, MAX_BACKOFF_MS)
      const retryAfter = refusal?.retryAfterMs ?? null
      const delay =
        retryAfter === null
          ? backoff
          : Math.max(backoff, retryAfter) * (1 + Math.random() * RETRY_AFTER_JITTER)
      // Only a 401 or a dropped stream may need a new token; ensureSession() rotates the refresh cookie on every call.
      if (refusal && refusal.status !== 401) {
        retryTimer = setTimeout(() => {
          connect(token)
        }, delay)
        return
      }
      retryTimer = setTimeout(() => {
        ensureSession()
          .then((fresh) => {
            if (cancelled) return
            // A new token re-runs this effect, which owns that reconnect; connecting here too would double it.
            if (fresh === token) connect(fresh)
          })
          .catch((error: unknown) => {
            // Not gated on `cancelled`: logout() re-runs this effect, whose cleanup sets it.
            if (isAuthVerdict(error)) {
              redirectToLogin()
              return
            }
            if (!cancelled && useAuthStore.getState().isAuthenticated) {
              scheduleReconnect(token)
            }
          })
      }, delay)
    }

    /**
     * Opens the stream with `token` and feeds its frames to the list; a failure or an
     * end of stream schedules a reconnect.
     * @param token - The bearer token for this connection.
     */
    const connect = (token: string) => {
      if (cancelled) return
      const controller = new AbortController()
      abort = controller

      void (async () => {
        try {
          const response = await fetch(`${API_PREFIX}/notifications/stream`, {
            headers: {
              // In a header, never the URL, so the token stays out of history, Referer and logs.
              Authorization: `Bearer ${token}`,
              ...(lastEventId.current ? { 'Last-Event-ID': lastEventId.current } : {}),
            },
            signal: controller.signal,
          })

          if (response.status === 403) {
            // Required mode switched on mid-session: stay down until the account has a passkey.
            const body = (await response.json().catch(() => null)) as ApiErrorBody | null
            if (body?.code === PASSKEY_SETUP_REQUIRED) {
              usePasskeySetupStore.getState().setRequired(true, body.message)
              return
            }
          }
          if (!response.ok || !response.body) {
            throw new StreamRefusedError(
              response.status,
              parseRetryAfter(response.headers.get('Retry-After'))
            )
          }
          refetchList()
          refetchCachedBilling()

          for await (const event of parseSseStream(response.body)) {
            if (event.id) lastEventId.current = event.id
            if (event.event === NOTIFICATION_EVENT) onNotification()
            else if (event.event === ENTITLEMENTS_EVENT) {
              const slug = parseEntitlementsSlug(event.data)
              if (slug) void invalidateBilling(queryClient, slug)
            }
          }
          if (!cancelled) scheduleReconnect(token)
        } catch (error) {
          if (controller.signal.aborted || cancelled) return
          scheduleReconnect(token, error instanceof StreamRefusedError ? error : undefined)
        }
      })()
    }

    connect(accessToken)

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      abort?.abort()
    }
  }, [accessToken, queryClient, setupRequired])
}
