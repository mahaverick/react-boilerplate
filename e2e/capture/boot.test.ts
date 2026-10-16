/**
 * @file The cold boot, frame by frame: a CDP screencast of an unthrottled
 * load with the cache disabled, as the dev server serves it, and, for the
 * `nginx-` scenarios, as a production build serves it (E2E_NGINX_ORIGIN).
 * Distinct frames go to docs/pages/img/boot/<scenario>--<nn>.jpg, at most 16
 * per scenario: a time-spread sample plus the first frame at each boot mark
 * (shell, first-content), the first distinct frame and the last. The names
 * carry no timings, so a rerun rewrites the same files. Each scenario's
 * `{ frames: { file, ms, label? }[], totalMs, distinctFrames }` goes to
 * test-results/capture/boot.json. Needs the dev stack already up.
 */
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { apiIsReady, createVerifiedUser, freshEmail, logIn } from '../live/helpers'
import { DOCS_DIR } from './shoot'
import type { BootFrame } from './types'

test.skip(process.env.E2E_CAPTURE !== '1', 'capture only — run pnpm capture:pages')

/** Each scenario: a name, who is signed in, the URL, what marks it booted, and which server it runs against. */
const SCENARIOS = [
  { name: 'signed-out-login', signedIn: false, url: '/login', ready: 'form', origin: 'project' },
  {
    name: 'signed-in-dashboard',
    signedIn: true,
    url: '/dashboard',
    ready: 'main h1',
    origin: 'project',
  },
  {
    name: 'signed-in-tenants',
    signedIn: true,
    url: '/tenants',
    ready: 'main h1',
    origin: 'project',
  },
  {
    name: 'nginx-signed-out-login',
    signedIn: false,
    url: '/login',
    ready: 'form',
    origin: 'nginx',
  },
  {
    name: 'nginx-signed-in-dashboard',
    signedIn: true,
    url: '/dashboard',
    ready: 'main h1',
    origin: 'nginx',
  },
] as const

/** The most frames one scenario keeps. */
const MAX_FRAMES = 16

/** One scenario's saved frames. */
interface BootEntry {
  frames: BootFrame[]
  totalMs: number
  distinctFrames: number
}

/** Records a cold load of `url` and saves its distinct frames. */
async function screencast(
  page: Page,
  name: string,
  url: string,
  ready: string
): Promise<BootEntry> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  const frames: { data: string; at: number }[] = []
  cdp.on(
    'Page.screencastFrame',
    (frame: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
      frames.push({ data: frame.data, at: (frame.metadata.timestamp ?? 0) * 1000 })
      void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId })
    }
  )
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 })
  await page.addInitScript(() => {
    const marks: Record<string, number> = {}
    /** Records the first time `name` happened, on the wall clock the screencast stamps frames with. */
    const mark = (name: string) => {
      marks[name] ??= performance.timeOrigin + performance.now()
    }
    ;(window as unknown as { __bootMarks: Record<string, number> }).__bootMarks = marks
    new MutationObserver(() => {
      const root = document.getElementById('root')
      if (root?.querySelector('.boot-shell')) mark('shell')
      else if (root && root.childElementCount > 0) mark('first-content')
    }).observe(document, { childList: true, subtree: true })
  })
  await page.goto(url, { waitUntil: 'commit' })
  await page.locator(ready).first().waitFor({ state: 'visible', timeout: 60_000 })
  const marks = await page.evaluate(
    () => (window as unknown as { __bootMarks: Record<string, number> }).__bootMarks
  )
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  )
  await cdp.send('Page.stopScreencast')

  const distinct = frames.filter(
    (frame, index) => index === 0 || frame.data !== frames[index - 1]?.data
  )
  const start = distinct[0]?.at ?? 0
  const span = (distinct.at(-1)?.at ?? start) - start
  /** The index of the first frame at or after `time`, or the last frame when none is. */
  const firstAtOrAfter = (time: number) => {
    const found = distinct.findIndex((frame) => frame.at >= time)
    return found === -1 ? distinct.length - 1 : found
  }
  const labels = new Map<number, BootFrame['label']>()
  labels.set(0, 'first-paint')
  for (const name of ['shell', 'first-content'] as const) {
    const time = marks[name]
    if (time !== undefined && distinct.length > 0) {
      const index = firstAtOrAfter(time)
      if (!labels.has(index)) labels.set(index, name)
    }
  }
  labels.set(distinct.length - 1, 'ready')
  const picked = new Set<number>(labels.keys())
  const spread = Math.max(0, MAX_FRAMES - picked.size)
  for (let step = 1; step <= spread && distinct.length > MAX_FRAMES; step++) {
    const target = start + (span * step) / (spread + 1)
    let best = 0
    for (const [index, frame] of distinct.entries()) {
      if (Math.abs(frame.at - target) < Math.abs((distinct[best]?.at ?? 0) - target)) best = index
    }
    picked.add(best)
  }
  const indexes =
    distinct.length <= MAX_FRAMES
      ? distinct.map((_, index) => index)
      : [...picked].sort((x, y) => x - y).slice(0, MAX_FRAMES)
  const dir = path.join(DOCS_DIR, 'img', 'boot')
  await mkdir(dir, { recursive: true })
  // The scenario's earlier frames would sit beside the new ones when the count shrinks.
  for (const old of await readdir(dir)) {
    if (old.startsWith(`${name}--`)) await unlink(path.join(dir, old))
  }
  const files: BootFrame[] = []
  for (const [position, index] of indexes.entries()) {
    const frame = distinct[index]
    if (!frame) continue
    const file = `${name}--${String(position).padStart(2, '0')}.jpg`
    const label = labels.get(index)
    files.push({ file, ms: Math.round(frame.at - start), ...(label ? { label } : {}) })
    await writeFile(path.join(dir, file), Buffer.from(frame.data, 'base64'))
  }
  return { frames: files, totalMs: Math.round(span), distinctFrames: distinct.length }
}

/** Adds one scenario's frame list to test-results/capture/boot.json. */
async function recordBoot(name: string, entry: BootEntry): Promise<void> {
  const dir = path.resolve(import.meta.dirname, '../../test-results/capture')
  const file = path.join(dir, 'boot.json')
  await mkdir(dir, { recursive: true })
  const existing = await readFile(file, 'utf8').then(
    (text) => JSON.parse(text) as Record<string, BootEntry>,
    () => ({})
  )
  await writeFile(file, JSON.stringify({ ...existing, [name]: entry }, null, 2))
}

// baseURL is a test fixture, which a beforeAll cannot take, so the project's option is read instead.
test.beforeAll(async () => {
  const baseURL = test.info().project.use.baseURL ?? ''
  expect(await apiIsReady(), 'the API on :4040 is not up; start the dev stack first').toBe(true)
  const probe = await fetch(baseURL).catch(() => null)
  expect(probe?.ok, `${baseURL} is not serving; start the dev stack first`).toBe(true)
})

for (const scenario of SCENARIOS) {
  test(`boot: ${scenario.name}`, async ({ browser, baseURL }) => {
    const nginx = scenario.origin === 'nginx'
    test.skip(nginx && !process.env.E2E_NGINX_ORIGIN, 'set E2E_NGINX_ORIGIN to a production build')
    const context = await browser.newContext({
      baseURL: nginx ? process.env.E2E_NGINX_ORIGIN : baseURL,
    })
    if (scenario.signedIn) {
      const email = freshEmail()
      await createVerifiedUser(email)
      const page = await context.newPage()
      await logIn(page, email)
      // Closed so its notifications stream holds none of the boot's connections.
      await page.close()
    }
    const entry = await screencast(
      await context.newPage(),
      scenario.name,
      scenario.url,
      scenario.ready
    )
    await recordBoot(scenario.name, entry)
    await context.close()
  })
}
