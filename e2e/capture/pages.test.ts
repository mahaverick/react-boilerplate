/**
 * @file The page inventory's capture run (`pnpm capture:pages`): seeds the
 * accounts, signs each in three times (default, dark, mobile contexts), then
 * shoots every page route in the manifest and writes
 * test-results/capture/report.json. `CAPTURE_ONLY=auth,tenants` limits the run
 * to those areas, and a route key such as `/tenants/$tenantId/timeline` in the
 * same list limits it to that route, for an area too large for one rate-limit
 * window. Needs the dev stack already up; starts nothing.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Browser } from '@playwright/test'
import { apiIsReady, logIn } from '../live/helpers'
import { CAPTURES } from './manifest'
import { seedCapture } from './seed'
import { shootRoute, type SessionContexts } from './shoot'
import type { RouteCapture, ShotRecord } from './types'

test.skip(process.env.E2E_CAPTURE !== '1', 'capture only — run pnpm capture:pages')

const ONLY = new Set((process.env.CAPTURE_ONLY ?? '').split(',').filter(Boolean))

/** Three contexts for one account (or none, when `email` is undefined), each signed in on its own. */
async function sessionContexts(
  browser: Browser,
  baseURL: string,
  email?: string
): Promise<SessionContexts> {
  /** Creates one context with `options` and signs it in when there is an account. */
  const make = async (options: Parameters<Browser['newContext']>[0]) => {
    const context = await browser.newContext({ baseURL, ...options })
    if (email) {
      const page = await context.newPage()
      await logIn(page, email)
      await page.close()
    }
    return context
  }
  const dark = await make({ colorScheme: 'dark' })
  await dark.addInitScript(() => localStorage.setItem('theme', 'dark'))
  return {
    default: await make({}),
    dark,
    mobile: await make({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }),
  }
}

test('capture every page route', async ({ browser, baseURL }) => {
  expect(await apiIsReady(), 'the API on :4040 is not up; start the dev stack first').toBe(true)
  const probe = await fetch(baseURL!).catch(() => null)
  expect(probe?.ok, `${baseURL} is not serving; start the dev stack first`).toBe(true)

  const seed = await seedCapture()
  const sessions = new Map<string, SessionContexts>([
    ['anonymous', await sessionContexts(browser, baseURL!)],
  ])
  for (const [name, email] of Object.entries(seed.sessions)) {
    sessions.set(name, await sessionContexts(browser, baseURL!, email))
  }

  const dir = path.resolve(import.meta.dirname, '../../test-results/capture')
  await mkdir(dir, { recursive: true })
  const records: ShotRecord[] = []
  const skipped: { route: string; capture: RouteCapture }[] = []
  for (const [route, capture] of Object.entries(CAPTURES)) {
    if (capture.kind !== 'page') {
      skipped.push({ route, capture })
      continue
    }
    if (ONLY.size > 0 && !ONLY.has(capture.area) && !ONLY.has(route)) continue
    /** The named session's contexts; the manifest names only sessions the seed made. */
    const contextsFor = (name: string) => {
      const contexts = sessions.get(name)
      if (!contexts) throw new Error(`${route}: no session "${name}" in the seed`)
      return contexts
    }
    records.push(...(await shootRoute(contextsFor, route, capture, seed)))
    await writeFile(path.join(dir, 'report.json'), JSON.stringify({ records, skipped }, null, 2))
  }
  await writeFile(path.join(dir, 'report.json'), JSON.stringify({ records, skipped }, null, 2))
  for (const contexts of sessions.values()) {
    await contexts.default.close()
    await contexts.dark.close()
    await contexts.mobile.close()
  }
})
