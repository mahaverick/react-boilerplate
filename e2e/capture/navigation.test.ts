/**
 * @file In-app navigation, shot mid-flight: from a settled page, click a link
 * with the target route's code held (the route template shows) and again with
 * only its section requests held (the section skeletons show). A cold goto
 * only ever shows the boot shell, so this is where the route and section
 * templates are seen. Seeds its own accounts; needs the dev stack up; starts
 * nothing. `CAPTURE_ONLY` limits it by area, as `pages.test.ts` does.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Browser, type Page, type Route } from '@playwright/test'
import { apiIsReady, logIn } from '../live/helpers'
import { afterFontsAndFrames } from '../timing'
import { NAVIGATIONS } from './manifest'
import { controlRequests } from './route-control'
import { seedCapture } from './seed'
import { DOCS_DIR, fillUrl, RECORDS_DIR } from './shoot'
import type { NavigationCapture } from './types'

test.skip(process.env.E2E_CAPTURE !== '1', 'capture only — run pnpm capture:pages')

const ONLY = new Set((process.env.CAPTURE_ONLY ?? '').split(',').filter(Boolean))

/** A route's code: Vite's split-route modules in dev, the hashed chunks in a build. */
const ROUTE_CODE = /[?&]tsr-split=|\/assets\/[^/]+\.js$/

/** What one navigation's two shots found. */
interface NavigationRecord {
  shot: string
  routeTemplate: boolean
  sectionSkeleton: boolean
}

/** Opens `from` and waits for its heading, so the page is settled before anything is held. */
async function open(page: Page, from: string) {
  await page.goto(from)
  await page.locator('main h1').first().waitFor({ state: 'visible', timeout: 15_000 })
}

/** Clicks the in-app link whose accessible name starts with `link`: a tenant card link's name goes on with its slug and role. */
async function click(page: Page, link: string) {
  const name = new RegExp(`^${link.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}(\\s|$)`)
  await page.getByRole('link', { name }).first().click()
}

/** Whether `selector` became visible within 5 s. */
function appears(page: Page, selector: string): Promise<boolean> {
  return page
    .locator(selector)
    .first()
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(
      () => true,
      () => false
    )
}

/** Shoots `file` under docs/pages/ once fonts and two frames have settled. */
async function shoot(page: Page, file: string) {
  await afterFontsAndFrames(page)
  await page.screenshot({ path: path.join(DOCS_DIR, file), type: 'jpeg', quality: 70 })
}

/** A signed-in context for `email`. */
async function signedIn(browser: Browser, baseURL: string, email: string) {
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()
  await logIn(page, email)
  await page.close()
  return context
}

/** Shoots one navigation twice, the route template and then the section skeletons. */
async function shootNavigation(
  context: Awaited<ReturnType<typeof signedIn>>,
  nav: NavigationCapture,
  from: string,
  link: string
): Promise<NavigationRecord> {
  // The route template: the target's code held (installed after `from` settled, so only the target waits), and its requests too.
  const routePage = await context.newPage()
  const release: { now: () => void } = { now: () => undefined }
  const codeHeld = new Promise<void>((resolve) => {
    release.now = resolve
  })
  /** Holds a route-code request until the shot is taken. */
  const holdCode = async (route: Route) => {
    await codeHeld
    await route.continue().catch(() => undefined)
  }
  const { variant, nested } = nav.template
  let routeTemplate: boolean
  let routeControl: Awaited<ReturnType<typeof controlRequests>> | undefined
  try {
    await open(routePage, from)
    await routePage.route(ROUTE_CODE, holdCode)
    routeControl = await controlRequests(routePage, [{ action: 'hold', endpoints: nav.endpoints }])
    await click(routePage, link)
    routeTemplate = await appears(
      routePage,
      `[role="status"][aria-label="Loading"][data-variant="${variant}"][data-nested="${nested}"]`
    )
    await shoot(routePage, `img/${nav.area}/${nav.shot}--nav-route.jpg`)
  } finally {
    release.now()
    await routePage.unroute(ROUTE_CODE, holdCode).catch(() => undefined)
    await routeControl?.dispose()
    await routePage.close()
  }

  // The section skeletons: the code loads, the target's requests are held.
  const sectionPage = await context.newPage()
  let sectionSkeleton: boolean
  let sectionControl: Awaited<ReturnType<typeof controlRequests>> | undefined
  try {
    await open(sectionPage, from)
    sectionControl = await controlRequests(sectionPage, [
      { action: 'hold', endpoints: nav.endpoints },
    ])
    await click(sectionPage, link)
    sectionSkeleton = await appears(
      sectionPage,
      '[data-slot="query-state"][aria-busy="true"] [data-slot="skeleton"]'
    )
    await shoot(sectionPage, `img/${nav.area}/${nav.shot}--nav-sections.jpg`)
  } finally {
    await sectionControl?.dispose()
    await sectionPage.close()
  }
  return { shot: nav.shot, routeTemplate, sectionSkeleton }
}

test('capture in-app navigations', async ({ browser, baseURL }) => {
  expect(await apiIsReady(), 'the API on :4040 is not up; start the dev stack first').toBe(true)
  const seed = await seedCapture()
  const records: NavigationRecord[] = []
  for (const nav of NAVIGATIONS) {
    if (ONLY.size > 0 && !ONLY.has(nav.area)) continue
    const email = seed.sessions[nav.as]
    if (!email) throw new Error(`${nav.shot}: no session "${nav.as}" in the seed`)
    const context = await signedIn(browser, baseURL!, email)
    await mkdir(path.join(DOCS_DIR, 'img', nav.area), { recursive: true })
    records.push(
      await shootNavigation(context, nav, fillUrl(nav.from, seed), fillUrl(nav.link, seed))
    )
    await context.close()
  }
  await mkdir(RECORDS_DIR, { recursive: true })
  await writeFile(path.join(RECORDS_DIR, 'navigation.json'), JSON.stringify(records, null, 2))
})
