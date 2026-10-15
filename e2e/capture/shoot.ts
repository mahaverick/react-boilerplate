/**
 * @file Shoots one route: default, then loading (its sections' requests
 * held), error (answered 500) and empty, each from a fresh page, plus dark and
 * mobile defaults when the manifest asks. Never fails a route for missing UI:
 * what it saw goes into the records for the doc writer. A 429 anywhere stops
 * the run, since every shot after it would show the limiter, not the page.
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { expect, type BrowserContext, type Page } from '@playwright/test'
import { afterFontsAndFrames } from '../timing'
import { controlRequests, waitForLoadingUi, type Control, type Rule } from './route-control'
import type { RouteCapture, Seed, ShotRecord } from './types'

/** Where the shots go: the repo's docs/pages/. */
export const DOCS_DIR = path.resolve(import.meta.dirname, '../../docs/pages')

/** One session's three signed-in contexts. */
export interface SessionContexts {
  default: BrowserContext
  dark: BrowserContext
  mobile: BrowserContext
}

/** A manifest entry that is a page. */
type PageCapture = RouteCapture & { kind: 'page' }

/** Waits on the page after navigation and returns what it saw. */
type Settle = (page: Page, control: Control) => Promise<Partial<ShotRecord>>

/**
 * Fills `{name}` placeholders from the seed.
 * @throws When the seed lacks a placeholder's value.
 */
function fillUrl(url: string, seed: Seed): string {
  return url.replaceAll(/\{(\w+)\}/g, (_, name: string) => {
    const value = seed.params[name]
    if (value === undefined) throw new Error(`seed has no param "${name}" for ${url}`)
    return value
  })
}

/** Waits for `main` (or the auth card), then for any skeleton to go, each at most 15 s. */
const settled: Settle = async (page) => {
  await page
    .locator('main, [data-slot="card"]')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
  await expect(page.locator('[data-slot="skeleton"]'))
    .toHaveCount(0, { timeout: 15_000 })
    .catch(() => undefined)
  return {}
}

/**
 * Opens `target` in a new page of `context` under `rules`, waits with
 * `settle`, saves the shot and returns its record.
 * @throws When any /api/v1 response was a 429.
 */
async function shootOne(
  context: BrowserContext,
  capture: PageCapture,
  route: string,
  state: ShotRecord['state'],
  target: string,
  rules: readonly Rule[],
  settle: Settle
): Promise<ShotRecord> {
  const page = await context.newPage()
  const requests: string[] = []
  let limited = ''
  page.on('response', (response) => {
    const { pathname } = new URL(response.url())
    if (!pathname.startsWith('/api/v1/')) return
    requests.push(`${response.request().method()} ${pathname} ${response.status()}`)
    if (response.status() === 429) limited = pathname
  })
  const control = await controlRequests(page, rules)
  /** The stop message for a spent limiter; it replaces any other failure the 429 caused. */
  const limitedError = () =>
    new Error(
      `429 from ${limited}: a rate limiter is spent (refresh allows 300 per 5 min). Wait 5 minutes, then rerun with CAPTURE_ONLY=<areas not yet done>.`
    )
  try {
    const started = Date.now()
    await page.goto(target, { waitUntil: 'commit' })
    const extra = await settle(page, control)
    await afterFontsAndFrames(page)
    const file = `img/${capture.area}/${capture.shot}--${state}.jpg`
    await page.screenshot({
      path: path.join(DOCS_DIR, file),
      type: 'jpeg',
      quality: 70,
      fullPage: state === 'default',
    })
    if (limited) throw limitedError()
    return {
      route,
      state,
      file,
      requestedUrl: target,
      finalUrl: page.url(),
      requests,
      ms: Date.now() - started,
      ...extra,
    }
  } catch (error) {
    // A refresh the limiter refused can leave a screen with no main or card, so settle times out first.
    if (limited) throw limitedError()
    throw error
  } finally {
    await control.dispose().catch(() => undefined)
    await page.close().catch(() => undefined)
  }
}

/**
 * Takes every shot the manifest asks of one route.
 * @param contexts - The route's session, signed in three times.
 * @param route - The route's full path, for the records.
 * @param capture - The manifest entry.
 * @param seed - Placeholder values.
 */
export async function shootRoute(
  contexts: SessionContexts,
  route: string,
  capture: PageCapture,
  seed: Seed
): Promise<ShotRecord[]> {
  await mkdir(path.join(DOCS_DIR, 'img', capture.area), { recursive: true })
  const url = fillUrl(capture.url, seed)
  const endpoints = capture.sections.flatMap((section) => section.endpoints)
  /** Shoots one state of this route. */
  const shoot = (
    context: BrowserContext,
    state: ShotRecord['state'],
    target: string,
    rules: readonly Rule[],
    settle: Settle
  ) => shootOne(context, capture, route, state, target, rules, settle)

  const records = [await shoot(contexts.default, 'default', url, [], settled)]

  if (endpoints.length > 0) {
    records.push(
      await shoot(
        contexts.default,
        'loading',
        url,
        [{ action: 'hold', endpoints }],
        async (page, control) => ({
          loadingUi: await waitForLoadingUi(page, control),
        })
      ),
      await shoot(
        contexts.default,
        'error',
        url,
        [{ action: 'fail', endpoints, status: 500 }],
        async (page) => ({
          errorUi: await page
            .getByRole('alert')
            .first()
            .waitFor({ state: 'visible', timeout: 10_000 })
            .then(() => 'alert' as const)
            .catch(() => 'none' as const),
        })
      )
    )
  }

  const { empty } = capture
  if (empty && 'url' in empty) {
    records.push(await shoot(contexts.default, 'empty', fillUrl(empty.url, seed), [], settled))
  } else if (empty) {
    records.push(
      await shoot(contexts.default, 'empty', url, [{ action: 'stub', stubs: empty.stubs }], settled)
    )
  }

  if (capture.responsive) {
    records.push(
      await shoot(contexts.dark, 'dark', url, [], settled),
      await shoot(contexts.mobile, 'mobile', url, [], settled)
    )
  }
  return records
}
