import { expect, test } from '@playwright/test'
import { API_ORIGIN, apiIsReady, freshEmail, restartApi, signIn } from '../live/helpers'

/**
 * The last of open-items §1: **the SSE stream reconnects after a real backend
 * restart.**
 *
 * This could not be tested against the dev server, and the reason is worth
 * keeping. A `curl -N` at the Vite proxy stays open after the API is killed —
 * the proxy never propagates the upstream close — so the browser's
 * `EventSource` never fires `error`, `source.onerror` never runs, and the
 * reconnect path is simply unreachable. Measured from the page side too: no
 * stream request, no `/auth/refresh`, no console error. The tab never learned
 * it had been disconnected.
 *
 * nginx does propagate it. The same curl against the container exited on the
 * exact second the API was killed. So this suite runs against the PRODUCTION
 * image — the real bundle, the real `nginx.conf`, the real
 * `proxy_buffering off` — which is the path the behaviour actually ships on.
 *
 * Needs the container and a live API. `pnpm test:e2e:nginx` does the whole
 * thing; `beforeAll` says so if something is missing.
 */

const APP_ORIGIN = process.env.E2E_NGINX_ORIGIN ?? 'http://localhost:8088'

test.skip(process.env.E2E_LIVE !== '1', 'needs the nginx container — run pnpm test:e2e:nginx')

test.beforeAll(async () => {
  if (!(await apiIsReady())) {
    throw new Error(
      `No API at ${API_ORIGIN}. Start it: cd ../express-boilerplate && docker compose up -d && pnpm db:migrate && pnpm dev`
    )
  }
  const served = await fetch(APP_ORIGIN).catch(() => null)
  if (!served?.ok) {
    throw new Error(
      `No app at ${APP_ORIGIN}. Build and run the image: docker build -t react-boilerplate:e2e . && docker run -d --name rb-e2e -p 8088:80 --add-host=api:host-gateway react-boilerplate:e2e`
    )
  }
})

test('the notification stream reconnects after the backend really restarts', async ({ page }) => {
  // Stopping the API, confirming it is really down and waiting for a new one
  // to be ready is ~20s before the reconnect window even opens, and the hook's
  // backoff doubles to a 30s ceiling. Playwright's default 30s cannot hold it.
  test.setTimeout(240_000)

  const streamOpens: number[] = []
  page.on('request', (request) => {
    if (request.url().includes('/notifications/stream')) streamOpens.push(Date.now())
  })

  await signIn(page, freshEmail())
  await page.goto('/dashboard')
  await expect.poll(() => streamOpens.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1)

  // A real restart: the process is killed and a new one started. Not a mocked
  // error event — jsdom has no EventSource at all, so until now this path had
  // only ever run against a mock of the thing being tested.
  const killedAt = Date.now()
  await restartApi()
  const readyAt = Date.now()

  // The API really went down and really came back. restartApi throws if it
  // could not stop the server, but assert the elapsed time too: a restart that
  // took no time did not happen, and this test would then be measuring a
  // stream that was never interrupted.
  expect(readyAt - killedAt).toBeGreaterThan(2000)

  // TIMESTAMPED, not counted. `toBeGreaterThan(before)` would be satisfied by
  // a connection opened during sign-in that merely landed late — the reconnect
  // has to be a connection made AFTER the new server was up.
  await expect
    .poll(() => streamOpens.filter((at) => at > readyAt).length, {
      timeout: 120_000,
      intervals: [1000],
    })
    .toBeGreaterThan(0)

  // Reopening is not the same as working. The session has to survive it: the
  // reconnect runs through ensureSession(), and a wrong verdict there would
  // sign the reader out rather than reconnect them.
  await expect(page).not.toHaveURL(/login/)
  await expect(page.getByRole('button', { name: /notifications/i })).toBeVisible()
})
