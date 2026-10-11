/**
 * @file Session behaviours that need a real server, cookie jar and reload: a
 * reload keeps the user signed in with exactly one refresh, and the refresh
 * cookie carries the path and flags the SPA assumes. It needs a live
 * express-boilerplate (`E2E_API_ORIGIN`, default :4040) with its docker services,
 * so the file is skipped unless `E2E_LIVE=1`; run it with `pnpm test:e2e:live`.
 */
import { expect, test } from '@playwright/test'
import {
  API_ORIGIN,
  apiIsReady,
  createVerifiedUser,
  freshEmail,
  PASSWORD,
  signIn,
  waitForApi,
} from './helpers'

test.skip(process.env.E2E_LIVE !== '1', 'live backend required — run pnpm test:e2e:live')

test.beforeAll(async () => {
  if (!(await apiIsReady())) {
    throw new Error(
      `No API at ${API_ORIGIN}. Start it first: cd ../express-boilerplate && docker compose up -d && pnpm db:migrate && pnpm dev`
    )
  }
})

// The access token is memory-only, so a reload starts unauthenticated and the root route's beforeLoad must restore the session from the refresh cookie before any guard runs, or the user is bounced to /login.
test('a reload keeps you signed in, and refreshes exactly once', async ({ page }) => {
  await signIn(page, freshEmail())

  const refreshes: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/auth/refresh')) refreshes.push(request.url())
  })

  await page.reload()
  await expect(page).not.toHaveURL(/login/, { timeout: 15_000 })

  // Exactly one: `ensureSession()` is the only caller of /auth/refresh and single-flights concurrent 401s.
  expect(refreshes).toHaveLength(1)
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

  // Path is the one the SPA depends on surviving the proxy.
  expect(cookie).toMatch(/refreshToken=/)
  expect(cookie).toMatch(/Path=\/api\/v1\/auth/)
  expect(cookie).toMatch(/HttpOnly/i)
  expect(cookie).toMatch(/SameSite=Strict/i)

  /**
   * `X-Forwarded-Proto` does not drive this cookie's Secure flag: express's
   * `isCookieSecure(env)` (env.config.ts) returns
   * `COOKIE_SECURE ?? APP_ENV !== 'local'` and never reads `req.secure`, so
   * sending the header must change nothing. The header can set `req.secure`
   * (given TRUST_PROXY), but only the OAuth session cookie depends on that.
   */
  const forwarded = await request.post(`${API_ORIGIN}/api/v1/auth/login`, {
    headers: { 'X-Forwarded-Proto': 'https' },
    data: { email, password: PASSWORD },
  })
  expect(forwarded.status()).toBe(200)
  const forwardedCookie = forwarded
    .headersArray()
    .find((h) => h.name.toLowerCase() === 'set-cookie')?.value
  expect(forwardedCookie).not.toMatch(/;\s*Secure/i)

  // Neither cookie is Secure under APP_ENV=local with COOKIE_SECURE unset, which is how express's .env.example sets up the live backend.
  expect(cookie).not.toMatch(/;\s*Secure/i)
})
