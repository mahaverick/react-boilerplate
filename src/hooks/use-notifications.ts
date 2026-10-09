import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { API_PREFIX } from '@/constants/routes'
import { ensureSession, isAuthVerdict, redirectToLogin } from '@/http/session'
import { parseSseStream } from '@/http/sse'
import { notificationKeys } from '@/queries/notification.queries'
import { useAuthStore } from '@/states/auth.store'

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
 * Keep the notification list in step with the server's SSE stream, for as
 * long as there is a session.
 *
 * The stream is read with `fetch`, so the access token travels in a header,
 * never the URL (browser history, a Referer, request-line logs). Each
 * reconnect sends `Last-Event-ID` so the server can replay what was missed,
 * and every connect refetches the list, which covers the first connect (no
 * id, no replay). `fetch` has no built-in reconnect, so every reconnect is
 * `scheduleReconnect`'s, under a doubling backoff.
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
  const queryClient = useQueryClient()
  const backoffRef = useRef(INITIAL_BACKOFF_MS)
  const lastEventId = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!accessToken) return

    let abort: AbortController | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const refetchList = () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.list })
    }

    const onNotification = () => {
      backoffRef.current = INITIAL_BACKOFF_MS
      refetchList()
    }

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

          if (!response.ok || !response.body) {
            throw new StreamRefusedError(
              response.status,
              parseRetryAfter(response.headers.get('Retry-After'))
            )
          }
          refetchList()

          for await (const event of parseSseStream(response.body)) {
            if (event.id) lastEventId.current = event.id
            if (event.event === NOTIFICATION_EVENT) onNotification()
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
  }, [accessToken, queryClient])
}
