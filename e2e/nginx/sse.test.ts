import { expect, test } from '@playwright/test'
import {
  API_ORIGIN,
  apiIsReady,
  apiRestartRefusal,
  freshEmail,
  restartApi,
  signIn,
} from '../live/helpers'

/**
 * **The SSE stream reconnects after a real backend restart.**
 *
 * This cannot be tested against the dev server, and the reason is worth
 * keeping. A `curl -N` at the Vite proxy stays open after the API is
 * killed — the proxy never propagates the upstream close — so the reading
 * side of the client's `fetch` body stream never sees `done: true`,
 * `parseSseStream`'s generator never returns, and the reconnect path is
 * simply unreachable. Measured from the page side too: no stream request,
 * no `/auth/refresh`, no console error. The tab never learns it has been
 * disconnected.
 *
 * nginx does propagate it: the same curl against the container exits on
 * the exact second the API is killed. So this suite runs against the
 * PRODUCTION image — the real bundle, the real `nginx.conf`, the real
 * `proxy_buffering off` — which is the path the behaviour actually ships
 * on.
 *
 * Needs the container and a live API that this run may restart: an express
 * started from a git worktree on a port other than :4040, named by
 * `E2E_API_ORIGIN`, `E2E_API_DIR` and the container's `API_UPSTREAM`, with
 * `E2E_ALLOW_API_RESTART=1`. Without that it skips, saying why; CLAUDE.md
 * "End-to-end tests" has the command, and `beforeAll` says so if the API is
 * missing.
 */

const APP_ORIGIN = process.env.E2E_NGINX_ORIGIN ?? 'http://localhost:8088'

test.skip(process.env.E2E_LIVE !== '1', 'needs the nginx container — run pnpm test:e2e:nginx')
const restartRefusal = apiRestartRefusal()
test.skip(restartRefusal !== null, restartRefusal ?? '')

test.beforeAll(async () => {
  if (!(await apiIsReady())) {
    throw new Error(
      `No API at ${API_ORIGIN}. Start the worktree express on that port, as CLAUDE.md "End-to-end tests" describes for the SSE reconnect test`
    )
  }
  const served = await fetch(APP_ORIGIN).catch(() => null)
  if (!served?.ok) {
    throw new Error(
      `No app at ${APP_ORIGIN}. Run the image with API_UPSTREAM at the worktree express, as CLAUDE.md "End-to-end tests" describes for the SSE reconnect test`
    )
  }
})

/**
 * Stopping the API, confirming it is really down and waiting for a new one
 * to be ready is ~20s before the reconnect window even opens, and the
 * hook's backoff doubles to a 30s ceiling — Playwright's default 30s
 * cannot hold it, hence the extended test timeout.
 *
 * A real restart: the process is killed and a new one started — not
 * `MockFetchStream.end()`/`.fail()` (fetch-stream.ts), which close or
 * error a `ReadableStream` built by hand rather than a stream that closes
 * because a real server process actually died.
 *
 * `restartApi` throws if it could not stop the server, but the elapsed
 * time is asserted too: a restart that took no time did not happen, and
 * this test would then be measuring a stream that was never interrupted.
 *
 * The reconnect is asserted TIMESTAMPED, not counted:
 * `toBeGreaterThan(before)` would be satisfied by a connection opened
 * during sign-in that merely landed late — the reconnect has to be a
 * connection made AFTER the new server was up.
 *
 * Reopening is not the same as working. The session has to survive it:
 * the reconnect runs through ensureSession(), and a wrong verdict there
 * would sign the reader out rather than reconnect them.
 */
test('the notification stream reconnects after the backend really restarts', async ({ page }) => {
  test.setTimeout(240_000)

  const streamOpens: number[] = []
  page.on('request', (request) => {
    if (request.url().includes('/notifications/stream')) streamOpens.push(Date.now())
  })

  await signIn(page, freshEmail())
  await page.goto('/dashboard')
  await expect.poll(() => streamOpens.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1)

  const killedAt = Date.now()
  await restartApi()
  const readyAt = Date.now()

  expect(readyAt - killedAt).toBeGreaterThan(2000)

  await expect
    .poll(() => streamOpens.filter((at) => at > readyAt).length, {
      timeout: 120_000,
      intervals: [1000],
    })
    .toBeGreaterThan(0)

  await expect(page).not.toHaveURL(/login/)
  await expect(page.getByRole('button', { name: /notifications/i })).toBeVisible()
})
