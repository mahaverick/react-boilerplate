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
 * The server's own event name. `notification-stream.controller.ts` writes
 * `id: <id>\nevent: notification\ndata: <json>\n\n`, and `parseSseStream`
 * carries that name through on `event.event` unchanged. Checking against
 * anything else here — or dropping the check and reacting to every frame —
 * would misfire silently: no error, no log, just an inbox that either never
 * updates or updates on frames that were never notifications.
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
  // Survives across reconnects for the same reason backoffRef does: a fresh
  // `connect()` call must still know the last id this hook has seen, so the
  // very next request can ask the server to replay what it missed.
  const lastEventId = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!accessToken) return

    let abort: AbortController | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const refetchList = () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.list })
    }

    // Only a frame that actually ARRIVED clears the backoff — never a mere
    // successful connect. A backend that accepts the connection and then
    // ends the stream having delivered zero frames (an overloaded server, a
    // proxy that answers 200 and closes) resolves `fetch()` successfully
    // every time, so resetting the backoff there would pin the retry at one
    // second forever. Each of those retries calls ensureSession(), and every
    // refresh ROTATES the refresh cookie, so a reset-on-connect loop would be
    // one cookie rotation per second — from THIS tab alone. `inFlight`
    // (session.ts) is module-scoped, so it only dedupes concurrent calls
    // WITHIN a tab; it does nothing across tabs. Two tabs dropped by the same
    // backend restart both wake at the same 1s backoff with no jitter, both
    // POST /auth/refresh with the same pre-rotation cookie, and the loser
    // trips refresh-token reuse detection — signing both out. Pre-existing
    // (the EventSource hook had the same shape), out of scope here, and a
    // known limitation: fixing it means cross-tab coordination or jitter,
    // neither of which this backoff reset is a substitute for.
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
            // Only reconnect from here when the token did NOT change. This
            // backend rotates the access token on every refresh, so the usual
            // outcome is a new token in the store, which re-runs this effect —
            // and that re-run owns the reconnect. Connecting here as well
            // would open a second connection in the stale closure, one of
            // which is then immediately torn down by the cleanup.
            if (fresh === token) connect(fresh)
          })
          .catch((error: unknown) => {
            // ensureSession rejected, and WHY decides what happens next.
            //
            // A 401 — a dead refresh cookie — has already cleared the store,
            // and NOTHING ELSE MOVES THE USER. There is no `errorComponent`,
            // no store subscription and no `router.invalidate` anywhere, and
            // `_app.beforeLoad` runs only on navigation — so a tab that is
            // sitting still stays exactly where it is, signed out, showing
            // whatever it had cached. (An earlier comment here claimed "the
            // route guard is about to send the user to /login"; it does not,
            // and a rendered /dashboard with a 401 refresh proved it.) This
            // path therefore performs the redirect itself, through the same
            // routine the 401 interceptor calls.
            if (isAuthVerdict(error)) {
              redirectToLogin()
              return
            }
            // Not gated on `cancelled`: `logout()` updates the store, which
            // re-runs this effect and sets `cancelled` in its cleanup, so the
            // flag races the redirect. The session is over either way.

            // EVERY other failure leaves the session untouched (see
            // isAuthVerdict in http/session.ts): a deploy's 502, the refresh
            // rate limiter's 429, an unreachable API. Giving up on those
            // would let a few seconds of downtime kill notifications until
            // the next full page load, which is precisely the silent failure
            // this hook exists to avoid. Keep retrying, under the same
            // doubling backoff so a long outage costs little.
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
              // The whole point of this change: the credential travels in a
              // header, not the URL, so it never reaches browser history, a
              // Referer, or any log that records request lines.
              Authorization: `Bearer ${token}`,
              // EventSource sent this for us and could not be told not to;
              // fetch must send it explicitly. Absent on the very first
              // connect (there is no id yet), present on every reconnect —
              // which is the first time this hook can actually ask the
              // server to replay what it missed.
              ...(lastEventId.current ? { 'Last-Event-ID': lastEventId.current } : {}),
            },
            signal: controller.signal,
          })

          if (!response.ok || !response.body) {
            throw new Error(`stream failed: ${response.status}`)
          }
          // Every reconnect now sends `Last-Event-ID`, so the server CAN
          // replay what was missed — whether it actually does, and how far
          // back, is a property of the server's own replay window, not of
          // this hook. Any frame it does replay arrives as a normal
          // `notification` event below and invalidates the list itself. The
          // one case that definitely still needs this call is the very
          // first connect, which has no id yet and so gets no replay at
          // all. Calling it unconditionally rather than special-casing that
          // is deliberate: React Query dedupes it against whatever a replay
          // is about to trigger, so the common case costs nothing.
          refetchList()

          for await (const event of parseSseStream(response.body)) {
            if (event.id) lastEventId.current = event.id
            // `notification-stream.controller.ts` writes `:ping` comment
            // frames to keep a proxy from reaping an idle connection;
            // `parseSseStream` already drops those before they reach here,
            // so nothing below has to special-case them.
            if (event.event === NOTIFICATION_EVENT) onNotification()
          }
          // The generator ending means the server closed the connection.
          // There is no `retry:` directive to honor or override here — that
          // was EventSource's OWN built-in reconnect; `fetch` has none, so
          // every reconnect on this transport is this hook's own
          // scheduleReconnect, unconditionally.
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
