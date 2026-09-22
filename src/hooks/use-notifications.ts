import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { ensureSession } from '@/http/session'
import { notificationKeys } from '@/queries/notification.queries'
import { useAuthStore } from '@/states/auth.store'

const INITIAL_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000

/**
 * The server's own event name. `notification-stream.controller.ts` writes
 * `id: <id>\nevent: notification\ndata: <json>\n\n`, and `EventSource`
 * dispatches a NAMED event as its own type — `onmessage` fires only for
 * frames with no `event:` line. Registering `onmessage` here would therefore
 * never run, and nothing anywhere would say so: no error, no log, just an
 * inbox that silently stops updating.
 */
const NOTIFICATION_EVENT = 'notification'

/**
 * Keep the notification list in step with the server's SSE stream, for as
 * long as there is a session.
 *
 * Mount this ONCE, in `AppLayout`'s body — never in the bell or the page.
 * Two mounts open two connections, and anything rendered inside `Sidebar`
 * unmounts below 768px (it becomes a `Sheet`, a Base UI `Dialog.Popup` with
 * no `keepMounted`), which would leave the stream live on desktop and dead
 * on every phone.
 */
export function useNotificationStream(): void {
  const accessToken = useAuthStore((s) => s.accessToken)
  const queryClient = useQueryClient()
  // A ref, not state: it must survive the effect re-running when the token
  // rotates, so a flapping backend cannot reset its own backoff by causing a
  // refresh. Only a frame that actually arrived clears it.
  const backoffRef = useRef(INITIAL_BACKOFF_MS)

  useEffect(() => {
    if (!accessToken) return

    let source: EventSource | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const refetchList = () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.list })
    }

    // Only a frame that actually ARRIVED clears the backoff — never a mere
    // `open`. A backend that accepts the connection and then drops it (an
    // overloaded server, a proxy that answers 200 and closes) fires `open`
    // every time, so resetting there would pin the retry at one second
    // forever. Each of those retries calls ensureSession(), and every refresh
    // ROTATES the refresh cookie, so an `open`-reset loop would be one cookie
    // rotation per second — with two tabs open, exactly the concurrent-
    // rotation collision session.ts exists to prevent.
    const onNotification = () => {
      backoffRef.current = INITIAL_BACKOFF_MS
      refetchList()
    }

    const connect = (token: string) => {
      if (cancelled) return
      // A URL string, absolute from the root rather than built from
      // `apiClient`: EventSource takes a URL and ignores axios entirely, so
      // none of the client's baseURL, interceptors or headers apply here.
      source = new EventSource(`/api/v1/notifications/stream?token=${encodeURIComponent(token)}`)

      // Every reconnect below builds a NEW EventSource, and a new EventSource
      // sends no `Last-Event-ID` — so the server's replay of everything missed
      // while disconnected never fires for us. Refetching the list on open is
      // what recovers those notifications instead. (React Query dedupes this
      // against the first-load fetch, so the common case costs nothing.)
      source.addEventListener('open', refetchList)

      // The server's `retry: 3000` directive is deliberately overridden: it
      // governs EventSource's OWN reconnect, which re-requests the identical
      // URL — including an expired `?token=` — forever. The error path below
      // closes the connection instead, so that built-in retry never runs.
      // Its `:ping` comment frames dispatch no event at all; they exist only
      // to stop an idle connection being reaped by a proxy.
      source.addEventListener(NOTIFICATION_EVENT, onNotification)

      // An EventSource `error` event carries no status code, so this cannot
      // tell an expired token from dropped Wi-Fi. Closing and waiting for the
      // token to change would leave notifications dead for up to a token
      // lifetime after a one-second blip. Routing every error through
      // ensureSession() handles all three cases with one path: an expired
      // token is refreshed, a transient failure gets the same token back, and
      // a genuinely dead session logs out and stops the loop.
      source.onerror = () => {
        source?.close()
        source = null
        if (cancelled) return
        const delay = backoffRef.current
        backoffRef.current = Math.min(delay * 2, MAX_BACKOFF_MS)
        retryTimer = setTimeout(() => {
          ensureSession()
            .then((fresh) => {
              if (cancelled) return
              // Only reconnect from here when the token did NOT change. This
              // backend rotates the access token on every refresh, so the
              // usual outcome is a new token in the store, which re-runs this
              // effect — and that re-run owns the reconnect. Connecting here
              // as well would open a second connection in the stale closure,
              // one of which is then immediately torn down by the cleanup.
              if (fresh === token) connect(fresh)
            })
            .catch(() => {
              // ensureSession has already logged out. Stop retrying: the
              // route guard is about to send the user to /login.
            })
        }, delay)
      }
    }

    connect(accessToken)

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      source?.close()
    }
  }, [accessToken, queryClient])
}
