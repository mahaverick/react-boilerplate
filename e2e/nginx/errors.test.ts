import { expect, test, type Page, type Route } from '@playwright/test'
import {
  HUMAN_USER_AGENT,
  passPosthogBotFilter,
  routeCollectToFake,
  startFakePosthog,
  type FakePosthog,
  type FakePosthogEvent,
} from '../helpers/fake-posthog'
import { settle } from '../timing'
import { requireServedApp } from './csp'

/**
 * Error tracking through the production image, started as CI starts it
 * (`POSTHOG_KEY=phc_test_key_not_real`, `APP_ENVIRONMENT=ci`) with nothing
 * behind `/api`: the API is stubbed here, and `/api/v1/collect` reaches a
 * fake PostHog through Playwright. A crash has to come from the bundle's own
 * code to pass the in-app filter, so each one is a stubbed profile whose
 * `firstName` is a number: the account menu's `.trim()` throws on it while
 * rendering, as a real malformed response would make it.
 */

/** The `GIT_SHA` the image under test was built with; CI's e2e image takes none. */
const RELEASE = process.env.E2E_RELEASE ?? 'dev'

const USER_ID = '01a0fc35-0000-7000-8000-0000000005e1'
const TENANT_ID = '01a0fc35-0000-7000-8000-000000000a0e'
const PROBE_EMAIL = 'pii-probe@example.test'
const PROBE_TOKEN = 'pii-probe-token-'.padEnd(43, 'x')
/** What must never reach PostHog: the address, its local part, the name, the token. */
const PROBES = [PROBE_EMAIL, 'pii-probe', 'Probe', PROBE_TOKEN]

/** posthog-js's logger prefix: in its own lazy chunk, and in no chunk of the app's. */
const POSTHOG_JS_MARKER = '[PostHog.js]'

interface StubOptions {
  /** A number makes the account menu throw while rendering. */
  firstName?: string | number
  analyticsOptOut?: boolean
  /** How `GET /tenants/acme` answers. */
  tenantDetail?: 'ok' | 500 | 'network'
}

function envelope(data: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(
      status === 200
        ? { success: true, message: 'OK', statusCode: 200, data }
        : { success: false, message: 'Internal server error', statusCode: status }
    ),
  }
}

const TENANT_ROW = {
  id: TENANT_ID,
  name: 'Acme Corp',
  slug: 'acme',
  description: null,
  logo: null,
  website: null,
  lifecycleState: 'active',
  deletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  isPlatform: false,
}

/**
 * Answers the API for a signed-in user with one tenant. Every other API call
 * gets a 404, which no page treats as a sign-out; `/api/v1/collect` falls
 * through to the fake PostHog.
 */
async function stubApi(page: Page, options: StubOptions = {}): Promise<void> {
  const { firstName = 'Pii', analyticsOptOut = false, tenantDetail = 'ok' } = options
  await page.route('**/api/v1/**', async (route: Route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname.startsWith('/api/v1/collect')) return route.fallback()
    if (pathname === '/api/v1/auth/refresh') {
      return route.fulfill(envelope({ accessToken: 'stub-access-token' }))
    }
    if (pathname === '/api/v1/profile') {
      return route.fulfill(
        envelope({
          id: USER_ID,
          email: PROBE_EMAIL,
          firstName,
          lastName: 'Probe',
          createdAt: '2026-01-01T00:00:00.000Z',
          platformRole: null,
          analyticsOptOut,
        })
      )
    }
    if (pathname === '/api/v1/tenants') {
      return route.fulfill(envelope([{ tenant: TENANT_ROW, role: 'owner', isPlatform: false }]))
    }
    if (pathname === '/api/v1/tenants/acme') {
      if (tenantDetail === 'network') return route.abort('failed')
      if (tenantDetail === 500) return route.fulfill(envelope(null, 500))
      return route.fulfill(envelope({ ...TENANT_ROW, role: 'owner', access: 'member' }))
    }
    return route.fulfill(envelope(null, 404))
  })
}

/** The `$exception` events the fake has received. */
function exceptions(fake: FakePosthog): FakePosthogEvent[] {
  return fake.events().filter((event) => event.event === '$exception')
}

/** The first exception's mechanism in an event's `$exception_list`. */
function mechanismOf(event: FakePosthogEvent | undefined): { handled?: boolean } | undefined {
  const list = event?.properties.$exception_list as { mechanism?: { handled?: boolean } }[]
  return list[0]?.mechanism
}

const POLL = { intervals: [500], timeout: 30_000 }

/** The lazy reporter chunk, fetched on the first noted error. */
const REPORTER_CHUNK = /\/assets\/report-[^/]+\.js$/

/** The reporter's batch window (`BATCH_WINDOW_MS` in report.ts). */
const BATCH_WINDOW_MS = 2_000

/**
 * Every property an `$exception` may carry: the reporter's own and the
 * session ids `@posthog/core` adds. Nothing else (no title, no form value)
 * can carry text out.
 */
const EXCEPTION_PROPERTIES = new Set([
  '$exception_list',
  '$exception_level',
  'app',
  'origin',
  'release',
  'environment',
  'route_id',
  '$current_url',
  '$session_id',
  '$window_id',
  '$process_person_profile',
])

/**
 * Asserts that the fake holds exactly `count` exceptions after one more batch
 * window: a poll that just reached `count` cannot see a later event.
 * @param fake - The fake PostHog.
 * @param count - The exceptions it must hold.
 */
async function expectExactlyAfterBatch(fake: FakePosthog, count: number): Promise<void> {
  await settle(
    BATCH_WINDOW_MS + 1_000,
    'absence has no event: one reporter batch window and its send'
  )
  expect(exceptions(fake)).toHaveLength(count)
}

test.describe('error tracking against a fake PostHog', () => {
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
    'a consented crash is one $exception with the user, the session, the route and the release',
    { tag: '@no-api' },
    async ({ page }) => {
      await stubApi(page, { firstName: 42 })
      await page.goto('/dashboard')
      await expect(
        page.getByRole('heading', { name: 'Something went wrong', level: 1 })
      ).toBeVisible()

      await expect.poll(() => exceptions(fake).length, POLL).toBe(1)
      await expectExactlyAfterBatch(fake, 1)
      const [event] = exceptions(fake)
      expect(event?.path).toBe('/batch/')
      expect(event?.distinctId).toBe(USER_ID)
      expect(event?.properties).toMatchObject({
        app: 'react',
        environment: 'ci',
        release: RELEASE,
        route_id: '/_app/dashboard',
        $exception_level: 'error',
      })
      expect(event?.properties.$session_id).toEqual(expect.any(String))
      expect(event?.properties.$window_id).toEqual(expect.any(String))
      expect(mechanismOf(event)?.handled).toBe(true)
      const list = event?.properties.$exception_list as {
        type: string
        stacktrace: { frames: { in_app: boolean; filename: string; platform: string }[] }
      }[]
      expect(list[0]?.type).toBe('TypeError')
      const inApp = list[0]?.stacktrace.frames.filter((frame) => frame.in_app) ?? []
      expect(inApp.length).toBeGreaterThan(0)
      for (const frame of inApp) {
        expect(frame.filename).toMatch(/\/assets\/[^/]+\.js$/)
        expect(frame.platform).toBe('web:javascript')
      }
    }
  )

  test(
    'an opted-out crash is anonymous, with a different distinct id per event',
    { tag: '@no-api' },
    async ({ page }) => {
      await stubApi(page, { firstName: 42, analyticsOptOut: true })
      await page.goto('/dashboard')
      const alert = page.getByRole('alert')
      await expect(alert.getByRole('heading', { name: 'Something went wrong' })).toBeVisible()
      await expect.poll(() => exceptions(fake).length, POLL).toBe(1)
      // Try again renders the menu again, which throws again: a new crash, one more event.
      await alert.getByRole('button', { name: 'Try again' }).click()
      await expect.poll(() => exceptions(fake).length, POLL).toBe(2)
      await expectExactlyAfterBatch(fake, 2)

      const events = exceptions(fake)
      for (const event of events) {
        expect(event.distinctId).not.toBe(USER_ID)
        expect(event.properties.$process_person_profile).toBe(false)
        expect(event.properties).not.toHaveProperty('$session_id')
        expect(event.properties).not.toHaveProperty('$groups')
      }
      expect(new Set(events.map((event) => event.distinctId)).size).toBe(events.length)
    }
  )

  test(
    'a crash before posthog-js has loaded still arrives, with the user once analytics settles',
    { tag: '@no-api' },
    async ({ page }) => {
      let releasePosthog: () => void = () => {}
      const posthogHeld = new Promise<void>((resolve) => {
        releasePosthog = resolve
      })
      let heldChunk: string | undefined
      await page.route('**/assets/*.js', async (route) => {
        const response = await route.fetch()
        const body = await response.text()
        if (body.includes(POSTHOG_JS_MARKER)) {
          heldChunk = route.request().url()
          await posthogHeld
        }
        await route.fulfill({ response, body })
      })
      const reporter = page.waitForResponse(REPORTER_CHUNK)
      await stubApi(page, { firstName: 42 })
      await page.goto('/dashboard')
      await expect(
        page.getByRole('heading', { name: 'Something went wrong', level: 1 })
      ).toBeVisible()
      await expect.poll(() => heldChunk, POLL).toBeDefined()
      await reporter
      await settle(
        BATCH_WINDOW_MS + 1_000,
        'absence has no event: the loaded reporter batches for 2 s, and must still be waiting for analytics'
      )
      expect(exceptions(fake)).toEqual([])

      releasePosthog()
      await expect.poll(() => exceptions(fake).length, POLL).toBe(1)
      await expectExactlyAfterBatch(fake, 1)
      expect(exceptions(fake)[0]?.distinctId).toBe(USER_ID)
    }
  )

  test('an API 500 and a network failure send nothing', { tag: '@no-api' }, async ({ page }) => {
    const reporter = page.waitForResponse(REPORTER_CHUNK)
    await stubApi(page, { tenantDetail: 500 })
    await page.goto('/tenants/acme')
    await expect(page.getByText(/could not load this tenant/i)).toBeVisible()
    await reporter

    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await routeCollectToFake(page, fake)
    await stubApi(page, { tenantDetail: 'network' })
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByText(/could not load this tenant/i)).toBeVisible()

    await settle(4_000, 'absence has no event: the reporter batches for 2 s before it sends')
    expect(exceptions(fake)).toEqual([])

    // The control: the same fake, routed the same way, does receive a real crash.
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await routeCollectToFake(page, fake)
    await stubApi(page, { firstName: 42 })
    await page.goto('/dashboard')
    await expect(
      page.getByRole('heading', { name: 'Something went wrong', level: 1 })
    ).toBeVisible()
    await expect.poll(() => exceptions(fake).length, POLL).toBe(1)
    const list = exceptions(fake)[0]?.properties.$exception_list as { type: string }[]
    expect(list[0]?.type).toBe('TypeError')
  })

  test(
    'a chunk that fails to load arrives as handled, from chunk_load',
    { tag: '@no-api' },
    async ({ page }) => {
      let isBlocked = false
      await page.route(/\/assets\/forgot-password[^/]*\.js$/, async (route) => {
        isBlocked = true
        await route.abort('failed')
      })
      await page.goto('/forgot-password')
      await expect(
        page.getByRole('heading', { name: 'A new version is available', level: 1 })
      ).toBeVisible()
      expect(isBlocked).toBe(true)

      await expect.poll(() => exceptions(fake).length, POLL).toBeGreaterThan(0)
      await settle(
        BATCH_WINDOW_MS + 1_000,
        'absence has no event: a second chunk-load report would leave in the next batch'
      )
      expect(exceptions(fake)).toHaveLength(1)
      const [event] = exceptions(fake)
      expect(event?.properties.origin).toBe('chunk_load')
      expect(mechanismOf(event)?.handled).toBe(true)
    }
  )

  test(
    'no address, name or token reaches PostHog in an exception',
    { tag: '@no-api' },
    async ({ page }) => {
      await stubApi(page, { firstName: 42 })
      await page.goto(`/dashboard?token=${PROBE_TOKEN}&email=${encodeURIComponent(PROBE_EMAIL)}`)
      await expect(
        page.getByRole('heading', { name: 'Something went wrong', level: 1 })
      ).toBeVisible()
      await expect.poll(() => exceptions(fake).length, POLL).toBe(1)

      // A second crash with the address in the path.
      await page.goto(`/tenants/${PROBE_EMAIL}`)
      await expect(
        page.getByRole('heading', { name: 'Something went wrong', level: 1 })
      ).toBeVisible()
      await expect.poll(() => exceptions(fake).length, POLL).toBe(2)
      // Read before the synthetic title, which replay records and $pageview sends; react's titles carry at most the slug, already in the URL.
      const egress = fake.bodies()
      // A third, with the probes in the title and a form field.
      await page.evaluate(
        ({ email, token }) => {
          document.title = `${email} ${token}`
          const field = document.createElement('input')
          field.name = 'token'
          field.value = token
          document.body.append(field)
        },
        { email: PROBE_EMAIL, token: PROBE_TOKEN }
      )
      await page.getByRole('alert').getByRole('button', { name: 'Try again' }).click()
      await expect.poll(() => exceptions(fake).length, POLL).toBe(3)
      await expectExactlyAfterBatch(fake, 3)

      const [event, second] = exceptions(fake)
      expect(event?.properties.$current_url).toMatch(/\/dashboard$/)
      expect(second?.properties.$current_url).toMatch(/\/tenants\/\[email\]$/)
      for (const crash of exceptions(fake)) {
        expect(
          Object.keys(crash.properties).filter((key) => !EXCEPTION_PROPERTIES.has(key))
        ).toEqual([])
      }
      const payload = JSON.stringify(exceptions(fake))
      for (const probe of PROBES) expect(payload, `"${probe}" reached PostHog`).not.toContain(probe)
      for (const probe of [PROBE_TOKEN, encodeURIComponent(PROBE_EMAIL)]) {
        expect(egress, `"${probe}" reached PostHog`).not.toContain(probe)
      }
    }
  )
})
