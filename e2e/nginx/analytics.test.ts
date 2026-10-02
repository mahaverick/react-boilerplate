import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import {
  clickUntilReplayed,
  FAKE_POSTHOG_PORT,
  HUMAN_USER_AGENT,
  passPosthogBotFilter,
  REPLAY_UPLOAD_TIMEOUT_MS,
  routeCollectToFake,
  startFakePosthog,
  type FakePosthog,
  type FakePosthogEvent,
} from '../helpers/fake-posthog'
import {
  API_ORIGIN,
  apiIsReady,
  apiLogin,
  apiRequest,
  createTenant,
  createVerifiedUser,
  freshSlug,
  logIn,
} from '../live/helpers'
import {
  CONTENT_SECURITY_POLICY,
  flushCspReports,
  requireServedApp,
  SECURITY_HEADERS,
  watchCspViolations,
} from './csp'

/**
 * Analytics through the production image, started with the run-time
 * settings CI gives it: `POSTHOG_KEY=phc_test_key_not_real`,
 * `APP_ENVIRONMENT=ci` and `ANALYTICS_HANDOFF_ORIGINS=https://www.example.test`
 * (`pnpm test:e2e:nginx` starts it the same way).
 *
 * The `@no-api` tests run in CI with nothing behind `/api`: nginx's own
 * `/runtime-config.js` and `/api/v1/collect/` locations, and posthog-js in
 * the real bundle under the real policy, its `/api/v1/collect` traffic
 * answered by a fake PostHog through Playwright in place of express's proxy.
 *
 * The rest are the live half (`E2E_LIVE=1 E2E_ANALYTICS=1`): an express
 * 1.5.0+ behind the image with `POSTHOG_PROJECT_KEY=phc_test_key_not_real`
 * and `POSTHOG_HOST`/`POSTHOG_ASSETS_HOST` at this suite's fake PostHog on
 * `FAKE_POSTHOG_PORT` (4063), which then receives the browser's traffic
 * through express's proxy and express's own drain on `/batch/`. The steps
 * are in the README's "Analytics (PostHog)" section.
 */

/** The origin the CI container allowlists for the handoff (`ANALYTICS_HANDOFF_ORIGINS`). */
const HANDOFF_ORIGIN = 'https://www.example.test'

const PROBE_NAME = { firstName: 'Pii', lastName: 'Probe' }
/** A token of the shape the invitation, reset and verify pages accept. */
const PROBE_TOKEN = 'pii-probe-token-'.padEnd(43, 'x')
const PROBE_EMAIL = 'pii-probe@example.test'
/** What must never reach PostHog: each name part, the address prefix, the token. */
const PROBES = ['Pii', 'Probe', 'pii-probe', PROBE_TOKEN]

/** A W3C traceparent's trace id. */
function traceIdOf(traceparent: string | undefined): string | undefined {
  return /^00-([0-9a-f]{32})-[0-9a-f]{16}-01$/.exec(traceparent ?? '')?.[1]
}

/** Waits until a replay snapshot containing `text` has arrived: replay flushes on its own schedule. */
async function replayContains(fake: FakePosthog, text: string): Promise<void> {
  await expect
    .poll(() => fake.bodiesFor('/s/').some((body) => body.includes(text)), {
      message: `no replay snapshot containing "${text}" reached the fake PostHog`,
      intervals: [500],
      // Room for two flushes: the page's own, and one more if the text arrived after it.
      timeout: 2 * REPLAY_UPLOAD_TIMEOUT_MS,
    })
    .toBe(true)
}

/** Whether the fake has a browser `$pageview` of `pathname`. */
function sawPageview(fake: FakePosthog, pathname: string): boolean {
  return fake
    .events()
    .some((event) => event.event === '$pageview' && event.properties.$pathname === pathname)
}

async function probeAccount(request: APIRequestContext, suffix: string) {
  const email = `pii-probe-${suffix}-${Date.now()}@example.test`
  await createVerifiedUser(email)
  const token = await apiLogin(email)
  await apiRequest(token, 'PATCH', '/profile', PROBE_NAME)
  const profile = await request.get(`${API_ORIGIN}/api/v1/profile`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const { data } = (await profile.json()) as { data: { id: string } }
  return { email, token, id: data.id }
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Account menu for/ }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login/)
}

test.describe('the run-time configuration', () => {
  test.beforeAll(requireServedApp)

  test(
    'is the container’s environment, never cached, under the security headers',
    { tag: '@no-api' },
    async ({ request }) => {
      const response = await request.get('/runtime-config.js')
      expect(response.status()).toBe(200)
      const headers = response.headers()
      expect(headers['content-type']).toBe('application/javascript')
      expect(headers['cache-control']).toBe('no-store')
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(headers[name], name).toBe(value)
      }
      expect(await response.text()).toBe(
        [
          'window.__APP_CONFIG__ = Object.freeze({',
          '  "POSTHOG_KEY": "phc_test_key_not_real",',
          '  "POSTHOG_UI_HOST": "",',
          '  "ANALYTICS_CONSENT_MODE": "",',
          `  "ANALYTICS_HANDOFF_ORIGINS": "${HANDOFF_ORIGIN}",`,
          '  "APP_ENVIRONMENT": "ci"',
          '})',
          '',
        ].join('\n')
      )
    }
  )

  test('loads before the bundle and reaches the app', { tag: '@no-api' }, async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible()
    expect(
      await page.evaluate(
        () => (window as { __APP_CONFIG__?: Record<string, string> }).__APP_CONFIG__
      )
    ).toMatchObject({ POSTHOG_KEY: 'phc_test_key_not_real', APP_ENVIRONMENT: 'ci' })
  })
})

test.describe('the /api/v1/collect/ location', () => {
  test.beforeAll(requireServedApp)

  test(
    'lets a replay batch of up to 10 MB through to the API',
    { tag: '@no-api' },
    async ({ request }) => {
      const response = await request.post('/api/v1/collect/s/?compression=gzip-js', {
        data: Buffer.alloc(9_000_000, 1),
        headers: { 'Content-Type': 'text/plain' },
      })
      // 502 with nothing behind /api, express's answer with it: the claim is only that nginx did not refuse it.
      expect(response.status()).not.toBe(413)
    }
  )

  test('refuses a body over its 10 MB limit', { tag: '@no-api' }, async ({ request }) => {
    const response = await request.post('/api/v1/collect/s/', {
      data: Buffer.alloc(11_000_000, 1),
      headers: { 'Content-Type': 'text/plain' },
    })
    expect(response.status()).toBe(413)
  })

  test(
    'leaves the rest of /api/ at nginx’s 1 MB default',
    { tag: '@no-api' },
    async ({ request }) => {
      const response = await request.post('/api/v1/auth/login', {
        data: Buffer.alloc(2_000_000, 1),
        headers: { 'Content-Type': 'text/plain' },
      })
      expect(response.status()).toBe(413)
    }
  )
})

test.describe('analytics against a fake PostHog', () => {
  test.use({ userAgent: HUMAN_USER_AGENT })

  let fake: FakePosthog

  test.beforeAll(requireServedApp)

  test.beforeEach(async ({ page }) => {
    fake = await startFakePosthog()
    await passPosthogBotFilter(page)
    await routeCollectToFake(page, fake)
  })

  test.afterEach(async () => {
    await fake.close()
  })

  test(
    'replay records under the production CSP, through /api/v1/collect, with no worker',
    { tag: '@no-api' },
    async ({ page }) => {
      const violations = await watchCspViolations(page)
      const workers: string[] = []
      page.on('worker', (worker) => workers.push(worker.url()))

      const response = await page.goto('/login')
      expect(response?.headers()['content-security-policy']).toBe(CONTENT_SECURITY_POLICY)
      await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible()
      await page.getByRole('link', { name: 'Forgot password?' }).click()
      const heading = page.getByRole('heading', { name: 'Forgot your password?', level: 1 })
      await expect(heading).toBeVisible()
      await clickUntilReplayed(fake, heading, 'Forgot your password?')
      expect(fake.events().some((event) => event.properties.app === 'react')).toBe(true)
      expect(fake.events().every((event) => event.properties.environment === 'ci')).toBe(true)
      expect(fake.requests.some((request) => request.path.startsWith('/static/'))).toBe(true)
      await flushCspReports(page)
      expect(violations).toEqual([])
      expect(workers).toEqual([])
    }
  )

  test(
    'no token or address in a signed-out page’s URL or inputs reaches PostHog',
    { tag: '@no-api' },
    async ({ page }) => {
      test.setTimeout(90_000)
      const walk = [
        `/register?email=${encodeURIComponent(PROBE_EMAIL)}`,
        `/invitations/accept?token=${PROBE_TOKEN}`,
        `/reset-password?token=${PROBE_TOKEN}`,
        `/verify-email?token=${PROBE_TOKEN}`,
        `/login?redirect=${encodeURIComponent(`/invitations/accept?token=${PROBE_TOKEN}`)}`,
      ]
      for (const url of walk) {
        await page.goto(url)
        const heading = page.getByRole('heading', { level: 1 })
        await expect(heading).toBeVisible()
        if (url.startsWith('/login')) {
          await page.getByRole('textbox', { name: 'Email', exact: true }).fill(PROBE_EMAIL)
        }
        const { pathname } = new URL(url, 'http://localhost')
        await expect.poll(() => sawPageview(fake, pathname)).toBe(true)
        // The barrier: this page's replay, sent before the next load could drop it.
        await clickUntilReplayed(fake, heading, pathname)
      }
      // Page text from a full snapshot: replay's compressed DOM was decoded, so the search covers it.
      await replayContains(fake, 'Sign in')

      const egress = fake.bodies()
      for (const probe of [PROBE_TOKEN, 'pii-probe', encodeURIComponent(PROBE_EMAIL)]) {
        expect(egress, `"${probe}" reached PostHog`).not.toContain(probe)
      }
    }
  )

  test(
    'a handoff from the allowlisted site continues its visitor; any other is ignored; both are stripped',
    { tag: '@no-api' },
    async ({ page }) => {
      const handedOff = '01a0fc35-b7ee-7b93-b550-d8a7f98e30be'
      const crafted = '01a0fc35-b7ee-7b93-b550-d8a7f98e30bf'

      await page.goto(`/login?ph_did=${crafted}`, { referer: 'https://evil.example/' })
      await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible()
      await expect(page).toHaveURL(/\/login$/)

      await page.context().clearCookies()
      await page.evaluate(() => localStorage.clear())
      await page.goto(`/login?ph_did=${handedOff}`, { referer: `${HANDOFF_ORIGIN}/pricing` })
      await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible()
      await expect(page).toHaveURL(/\/login$/)

      await expect
        .poll(
          () =>
            fake
              .events()
              .some((event) => event.event === '$pageview' && event.distinctId === handedOff),
          { intervals: [500], timeout: 30_000 }
        )
        .toBe(true)
      expect(fake.events().some((event) => event.distinctId === crafted)).toBe(false)
    }
  )
})

test.describe('analytics end to end, through express', () => {
  test.skip(
    process.env.E2E_LIVE !== '1' || process.env.E2E_ANALYTICS !== '1',
    'needs express with analytics on behind the image — see the file comment'
  )
  test.use({ userAgent: HUMAN_USER_AGENT })

  let fake: FakePosthog

  test.beforeAll(async () => {
    if (!(await apiIsReady())) throw new Error(`No API at ${API_ORIGIN}`)
    await requireServedApp()
    fake = await startFakePosthog(FAKE_POSTHOG_PORT)
    const probe = await fetch(`${API_ORIGIN}/api/v1/collect/flags/?v=2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (probe.status === 404)
      throw new Error(`${API_ORIGIN} has no /api/v1/collect: older than 1.5.0`)
    if (probe.status === 503)
      throw new Error(`${API_ORIGIN} has analytics off: no POSTHOG_PROJECT_KEY`)
    if (!fake.requests.some((request) => request.path === '/flags/')) {
      throw new Error(`${API_ORIGIN} proxies /collect elsewhere: set POSTHOG_HOST=${fake.url}`)
    }
  })

  test.afterAll(async () => {
    await fake.close()
  })

  test.beforeEach(async ({ page }) => {
    fake.requests.length = 0
    await passPosthogBotFilter(page)
  })

  test('replay and events reach PostHog through nginx and express, under the CSP', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000)
    const user = await probeAccount(request, 'replay')
    const violations = await watchCspViolations(page)
    const workers: string[] = []
    page.on('worker', (worker) => workers.push(worker.url()))

    await logIn(page, user.email)
    const heading = page.getByRole('heading', { level: 1, name: /Welcome back/ })
    await expect(heading).toBeVisible()
    await clickUntilReplayed(fake, heading, 'Welcome back')
    expect(fake.requests.some((entry) => entry.path.startsWith('/static/'))).toBe(true)
    // express's proxy strips the credentials the browser sends with every /api request.
    for (const entry of fake.requests) {
      expect(entry.headers.cookie).toBeUndefined()
      expect(entry.headers.authorization).toBeUndefined()
    }
    await flushCspReports(page)
    expect(violations).toEqual([])
    expect(workers).toEqual([])
  })

  test('no probe name, address or token reaches PostHog over a signed-in route walk', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const owner = await probeAccount(request, 'owner')
    const slug = freshSlug()
    await createTenant(owner.token, { name: `Analytics ${slug}`, slug })
    await apiRequest(owner.token, 'POST', `/tenants/${slug}/invitations`, {
      email: `pii-probe-invitee-${Date.now()}@example.test`,
      role: 'viewer',
    })

    // Signed out first: these URLs carry the probe in their query strings.
    for (const path of [
      `/register?email=${encodeURIComponent(owner.email)}`,
      `/invitations/accept?token=${PROBE_TOKEN}`,
      `/reset-password?token=${PROBE_TOKEN}`,
      `/login?redirect=${encodeURIComponent(`/invitations/accept?token=${PROBE_TOKEN}`)}`,
    ]) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    }

    await logIn(page, owner.email)
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { level: 1, name: /Welcome back/ })).toBeVisible()
    await page.getByRole('button', { name: /Account menu for/ }).click()
    await page.keyboard.press('Escape')
    await page.goto('/profile')
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible()
    await page.goto('/notifications')
    await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible()
    await page.goto(`/tenants/${slug}/members`)
    await expect(page.getByRole('heading', { name: 'Pending invitations' })).toBeVisible()
    await page.getByRole('button', { name: /^Resend invitation to/ }).click()
    await expect(page.getByText(/^Invitation resent to/)).toBeVisible()
    await page.goto(`/tenants/${slug}/activity`)
    await expect(page.getByRole('list', { name: 'Activity' })).toBeVisible()
    await page.getByRole('combobox', { name: 'Filter by who acted' }).click()
    await page.getByRole('option', { name: 'Staff' }).click()

    // The control: the walk really was captured, replay included, and decoded.
    await replayContains(fake, 'Pending invitations')
    await expect
      .poll(() => fake.events().some((event) => event.event === 'table_filtered'))
      .toBe(true)
    const urls = fake.events().flatMap((event) => {
      const url = event.properties.$current_url
      return typeof url === 'string' ? [url] : []
    })
    expect(urls.some((url) => url.endsWith('/register'))).toBe(true)
    expect(urls.some((url) => url.endsWith('/invitations/accept'))).toBe(true)

    const egress = fake.bodies()
    for (const probe of PROBES) expect(egress, `"${probe}" reached PostHog`).not.toContain(probe)
  })

  test('server events carry the browser’s trace and replay session', async ({ page, request }) => {
    test.setTimeout(120_000)
    const user = await probeAccount(request, 'trace')
    const traceparents: string[] = []
    page.on('request', (entry) => {
      if (entry.url().endsWith('/api/v1/auth/login') && entry.method() === 'POST') {
        traceparents.push(entry.headers().traceparent ?? '')
      }
    })

    await logIn(page, user.email)
    await expect(page.getByRole('heading', { level: 1, name: /Welcome back/ })).toBeVisible()
    const traceId = traceIdOf(traceparents[0])
    expect(traceId, 'the sign-in request carried a traceparent').toBeDefined()

    // The account was set up with an API sign-in of its own, so the browser's is the one on its trace.
    let signedIn: FakePosthogEvent | undefined
    await expect
      .poll(
        () => {
          signedIn = fake
            .events()
            .find(
              (event) =>
                event.path === '/batch/' &&
                event.event === 'user_signed_in' &&
                event.distinctId === user.id &&
                event.properties.trace_id === traceId
            )
          return signedIn !== undefined
        },
        {
          message: 'express never drained a user_signed_in on the sign-in request’s trace',
          intervals: [500],
          timeout: 30_000,
        }
      )
      .toBe(true)
    const browserSessions = new Set(
      fake
        .events()
        .filter((event) => event.path !== '/batch/')
        .map((event) => event.properties.$session_id)
    )
    expect(signedIn?.properties.$session_id).toEqual(expect.any(String))
    expect(browserSessions.has(signedIn?.properties.$session_id)).toBe(true)
  })

  test('user A signs out, user B signs in on the same tab: B is never A', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)
    const userA = await probeAccount(request, 'a')
    const userB = await probeAccount(request, 'b')

    // A page closed by an earlier test can still flush into the shared fake, so only these two count.
    const identified = () =>
      fake
        .events()
        .filter(
          (event) =>
            event.event === '$identify' &&
            event.path !== '/batch/' &&
            [userA.id, userB.id].includes(event.distinctId ?? '')
        )
        .map((event) => event.distinctId)

    await logIn(page, userA.email)
    await expect(page.getByRole('heading', { level: 1, name: /Welcome back/ })).toBeVisible()
    await expect.poll(identified, { intervals: [500], timeout: 30_000 }).toEqual([userA.id])
    await signOut(page)
    await logIn(page, userB.email)
    await expect(page.getByRole('heading', { level: 1, name: /Welcome back/ })).toBeVisible()
    // Each identify is waited for before the next full page load, which would drop an unsent batch.
    await expect
      .poll(identified, { intervals: [500], timeout: 30_000 })
      .toEqual([userA.id, userB.id])
    await page.goto('/profile')
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible()
    await expect.poll(() => sawPageview(fake, '/profile')).toBe(true)
    const browser = fake.events().filter((event) => event.path !== '/batch/')
    const identifyB = browser.findIndex(
      (event) => event.event === '$identify' && event.distinctId === userB.id
    )
    expect(identifyB).toBeGreaterThan(-1)
    expect(browser[identifyB]?.properties.$anon_distinct_id).not.toBe(userA.id)
    const afterB = browser.slice(identifyB)
    expect(afterB.length).toBeGreaterThan(1)
    expect(afterB.every((event) => event.distinctId !== userA.id)).toBe(true)
    // Every browser event, before and after the reset, still says where it came from.
    expect(browser.every((event) => event.properties.app === 'react')).toBe(true)

    await expect
      .poll(
        () =>
          fake
            .events()
            .some(
              (event) =>
                event.path === '/batch/' &&
                event.event === 'user_signed_out' &&
                event.distinctId === userA.id
            ),
        { message: 'express never drained user_signed_out', intervals: [500], timeout: 30_000 }
      )
      .toBe(true)
  })
})
