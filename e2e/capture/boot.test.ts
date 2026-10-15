/**
 * @file The cold boot, frame by frame: a CDP screencast of an unthrottled
 * load with the cache disabled, as the dev server serves it.
 * Distinct frames go to docs/pages/img/boot/<scenario>--<nn>-<ms>ms.jpg,
 * at most 12 per scenario, sampled evenly by time. The frame lists go to
 * test-results/capture/boot.json. Needs the dev stack already up.
 */
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test, type Page } from '@playwright/test'
import { createVerifiedUser, freshEmail, logIn } from '../live/helpers'
import { DOCS_DIR } from './shoot'

test.skip(process.env.E2E_CAPTURE !== '1', 'capture only — run pnpm capture:pages')

/** Each scenario: a name, who is signed in, the URL, and what marks it booted. */
const SCENARIOS = [
  { name: 'signed-out-login', signedIn: false, url: '/login', ready: 'form' },
  { name: 'signed-in-dashboard', signedIn: true, url: '/dashboard', ready: 'main h1' },
  { name: 'signed-in-tenants', signedIn: true, url: '/tenants', ready: 'main h1' },
] as const

/** One scenario's saved frames. */
interface BootEntry {
  files: string[]
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
  await page.goto(url, { waitUntil: 'commit' })
  await page.locator(ready).first().waitFor({ state: 'visible', timeout: 60_000 })
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  )
  await cdp.send('Page.stopScreencast')

  const distinct = frames.filter(
    (frame, index) => index === 0 || frame.data !== frames[index - 1]?.data
  )
  const start = distinct[0]?.at ?? 0
  const span = (distinct.at(-1)?.at ?? start) - start
  const picked = new Set<number>([0, distinct.length - 1])
  for (let step = 1; step < 11 && distinct.length > 12; step++) {
    const target = start + (span * step) / 11
    let best = 0
    for (const [index, frame] of distinct.entries()) {
      if (Math.abs(frame.at - target) < Math.abs((distinct[best]?.at ?? 0) - target)) best = index
    }
    picked.add(best)
  }
  const kept =
    distinct.length <= 12
      ? distinct
      : [...picked].sort((x, y) => x - y).flatMap((index) => distinct[index] ?? [])
  const dir = path.join(DOCS_DIR, 'img', 'boot')
  await mkdir(dir, { recursive: true })
  // A rerun's timings differ, so the scenario's earlier frames would sit beside the new ones.
  for (const old of await readdir(dir)) {
    if (old.startsWith(`${name}--`)) await unlink(path.join(dir, old))
  }
  const files: string[] = []
  for (const [index, frame] of kept.entries()) {
    const ms = Math.round(frame.at - start)
    const file = `${name}--${String(index).padStart(2, '0')}-${ms}ms.jpg`
    files.push(file)
    await writeFile(path.join(dir, file), Buffer.from(frame.data, 'base64'))
  }
  return { files, totalMs: Math.round(span), distinctFrames: distinct.length }
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

for (const scenario of SCENARIOS) {
  test(`boot: ${scenario.name}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL })
    if (scenario.signedIn) {
      const email = freshEmail()
      await createVerifiedUser(email)
      await logIn(await context.newPage(), email)
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
