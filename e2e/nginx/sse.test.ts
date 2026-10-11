/**
 * @file The SSE stream reconnects after a real backend restart, which only the
 * production image can show: the Vite proxy never propagates an upstream close,
 * so against `pnpm dev` the client's `fetch` body stream never sees `done: true`
 * and the reconnect path is unreachable, while nginx ends the stream the second
 * the API dies. It needs the container and an express this run may restart (a
 * git worktree on a port other than :4040, named by `E2E_API_ORIGIN`,
 * `E2E_API_DIR` and the container's `API_UPSTREAM`, with
 * `E2E_ALLOW_API_RESTART=1`), and skips saying why otherwise; CLAUDE.md "End-to-end
 * tests" has the command.
 */
import { expect, test } from '@playwright/test'
import {
  API_ORIGIN,
  apiIsReady,
  apiRestartRefusal,
  freshEmail,
  restartApi,
  signIn,
} from '../live/helpers'

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

// Stopping the API and waiting for a replacement takes tens of seconds, and the hook's backoff doubles to a 30s ceiling, which Playwright's default 30s test timeout cannot hold.
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
  // A real restart: the process is killed and a replacement started, not a hand-built stream closed by a mock.
  await restartApi()
  const readyAt = Date.now()

  // A restart that took no time did not happen, and the test would measure a stream never interrupted.
  expect(readyAt - killedAt).toBeGreaterThan(2000)

  // Timestamped, not counted: a count would pass on a connection opened during sign-in that landed late, but the reconnect must be made after the replacement server was up.
  await expect
    .poll(() => streamOpens.filter((at) => at > readyAt).length, {
      timeout: 120_000,
      intervals: [1000],
    })
    .toBeGreaterThan(0)

  // Reopening is not enough: the reconnect runs through ensureSession(), and a wrong verdict there would sign the user out.
  await expect(page).not.toHaveURL(/login/)
  await expect(page.getByRole('button', { name: /notifications/i })).toBeVisible()
})
