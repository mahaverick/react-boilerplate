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

    const scheduleReconnect = (token: string) => {
      if (cancelled) return
      const delay = backoffRef.current
      backoffRef.current = Math.min(delay * 2, MAX_BACKOFF_MS)
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
            throw new Error(`stream failed: ${response.status}`)
          }
          refetchList()

          for await (const event of parseSseStream(response.body)) {
            if (event.id) lastEventId.current = event.id
            if (event.event === NOTIFICATION_EVENT) onNotification()
          }
          if (!cancelled) scheduleReconnect(token)
        } catch {
          if (controller.signal.aborted || cancelled) return
          scheduleReconnect(token)
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
