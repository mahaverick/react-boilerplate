import { expect, test } from '@playwright/test'
import {
  API_ORIGIN,
  apiIsReady,
  createVerifiedUser,
  freshEmail,
  PASSWORD,
  restartApi,
  waitForApi,
} from './helpers'

/**
 * The three behaviours `docs/superpowers/decisions/2026-09-22-open-items.md`
 * §1 records as NEVER HAVING BEEN EXECUTED. Each is unit-tested and was
 * inferred end to end; each needs a real server, a real cookie jar and a real
 * reload, which is exactly what the test harness did not have.
 *
 * Requires a live express-boilerplate on :4040 plus its docker services, so
 * the whole file is skipped unless `E2E_LIVE=1`. Run it with
 * `pnpm test:e2e:live`.
 */

test.skip(process.env.E2E_LIVE !== '1', 'live backend required — run pnpm test:e2e:live')

test.beforeAll(async () => {
  if (!(await apiIsReady())) {
    throw new Error(
      `No API at ${API_ORIGIN}. Start it first: cd ../express-boilerplate && docker compose up -d && pnpm db:migrate && pnpm dev`
    )
  }
})

/** Signs in through the real UI, leaving the browser with a real session. */
async function signIn(page: import('@playwright/test').Page, email: string) {
  await createVerifiedUser(email)
  await page.goto('/login')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/password/i).fill(PASSWORD)
  await page.getByRole('button', { name: /sign in|log in/i }).click()
  await expect(page).not.toHaveURL(/login/, { timeout: 15_000 })
}

test('a reload keeps you signed in, and refreshes exactly once', async ({ page }) => {
  await signIn(page, freshEmail())

  // The access token is memory-only by design (CLAUDE.md), so a reload starts
  // unauthenticated and the root route's beforeLoad has to restore the session
  // from the refresh cookie before any guard runs. If that ordering is wrong
  // the reader is bounced to /login, which is the whole risk this pins.
  const refreshes: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/auth/refresh')) refreshes.push(request.url())
  })

  await page.reload()
  await expect(page).not.toHaveURL(/login/, { timeout: 15_000 })

  // EXACTLY one. `ensureSession()` is documented as the only caller of
  // /auth/refresh, and its single-flight wrapper is what makes N concurrent
  // 401s produce one refresh. Nothing had ever asserted the count.
  expect(refreshes).toHaveLength(1)
})

test.fixme('the notification stream reconnects after the backend really restarts', async ({
  page,
}) => {
  // NOT verifiable through the Vite dev proxy, and that was measured rather
  // than assumed.
  //
  // With the API killed, a `curl -N` against
  // http://localhost:5173/api/v1/notifications/stream stayed open — no EOF,
  // no error — while the same kill was plainly fatal upstream. The dev proxy
  // does not propagate the upstream close to the client. So the browser's
  // EventSource never fires `error`, `source.onerror` never runs,
  // `scheduleReconnect` is never called, and the whole reconnect path this
  // test exists to exercise is unreachable. Confirmed from the page side
  // too: after a real restart there was no stream request, no /auth/refresh
  // and no console error — the tab simply never learned it had been
  // disconnected.
  //
  // This is a property of the PROXY, not of the hook. The hook's logic reads
  // correctly and is unit-tested against a mock EventSource. Proving it end
  // to end needs the path production actually uses — the nginx container,
  // where the close does propagate — which is the same reason open-items
  // §1.3 could not be settled here either.
  //
  // Left in place as `fixme` rather than deleted: the behaviour is still
  // unverified, and a deleted test records nothing.
  test.setTimeout(240_000)
  await signIn(page, freshEmail())

  const streamOpens: number[] = []
  page.on('request', (request) => {
    if (request.url().includes('/notifications/stream')) streamOpens.push(Date.now())
  })

  await page.goto('/dashboard')
  await expect.poll(() => streamOpens.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(1)
  const before = streamOpens.length

  await restartApi()

  await expect
    .poll(() => streamOpens.length, { timeout: 90_000, intervals: [1000] })
    .toBeGreaterThan(before)

  await expect(page).not.toHaveURL(/login/)
})

test('the refresh cookie is scoped and flagged as the SPA assumes', async ({ request }) => {
  const email = freshEmail()
  await createVerifiedUser(email)
  await waitForApi()

  const response = await request.post(`${API_ORIGIN}/api/v1/auth/login`, {
    data: { email, password: PASSWORD },
  })
  expect(response.status()).toBe(200)
  const cookie = response.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie')?.value
  expect(cookie).toBeTruthy()

  // Each of these was "inferred" per open-items §1 — asserted here against a
  // real Set-Cookie for the first time. Path is the one the SPA depends on
  // surviving the proxy.
  expect(cookie).toMatch(/refreshToken=/)
  expect(cookie).toMatch(/Path=\/api\/v1\/auth/)
  expect(cookie).toMatch(/HttpOnly/i)
  expect(cookie).toMatch(/SameSite=Strict/i)

  // OPEN-ITEMS §1.3 IS MIS-STATED, and this is what corrects it.
  //
  // It claims `X-Forwarded-Proto` "drives the `secure` cookie flag". It does
  // not. `isSecureCookieEnvironment()` (auth.controller.ts) returns
  // `getEnv().NODE_ENV === 'production'` — the flag is keyed on NODE_ENV and
  // never reads `req.secure`, so no request header can change it. Sending the
  // header changes nothing, which is what this asserts.
  //
  // TRUST_PROXY is real and does matter, but for `req.ip`: it decides how much
  // of X-Forwarded-For to believe, and the IP-keyed rate limiters are what
  // consume it. That is a different mechanism from cookie security.
  const forwarded = await request.post(`${API_ORIGIN}/api/v1/auth/login`, {
    headers: { 'X-Forwarded-Proto': 'https' },
    data: { email, password: PASSWORD },
  })
  expect(forwarded.status()).toBe(200)
  const forwardedCookie = forwarded
    .headersArray()
    .find((h) => h.name.toLowerCase() === 'set-cookie')?.value
  expect(forwardedCookie).not.toMatch(/;\s*Secure/i)

  // And in development neither cookie is Secure, which is deliberate: a
  // browser refuses a Secure cookie over http://, so a hard-coded true would
  // make local cookie login impossible.
  expect(cookie).not.toMatch(/;\s*Secure/i)
})
