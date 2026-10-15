/**
 * @file The cold boot, frame by frame: a CDP screencast under a throttled
 * network ("Fast 3G": 150 ms latency, 1.6 Mbit/s down), cache disabled.
 * Distinct frames go to docs/pages/img/boot/<scenario>--<nn>-<ms>ms.jpg,
 * at most 12 per scenario. Needs the dev stack already up.
 */
import { mkdir, writeFile } from 'node:fs/promises'
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

/** Records a cold load of `url` and saves its distinct frames. */
async function screencast(page: Page, name: string, url: string, ready: string): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  })
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
  await page.locator(ready).first().waitFor({ state: 'visible', timeout: 240_000 })
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  )
  await cdp.send('Page.stopScreencast')

  const distinct = frames.filter(
    (frame, index) => index === 0 || frame.data !== frames[index - 1]?.data
  )
  const start = distinct[0]?.at ?? 0
  const kept = distinct.length <= 12 ? distinct : [...distinct.slice(0, 11), distinct.at(-1)!]
  const dir = path.join(DOCS_DIR, 'img', 'boot')
  await mkdir(dir, { recursive: true })
  for (const [index, frame] of kept.entries()) {
    const ms = Math.round(frame.at - start)
    await writeFile(
      path.join(dir, `${name}--${String(index).padStart(2, '0')}-${ms}ms.jpg`),
      Buffer.from(frame.data, 'base64')
    )
  }
}

for (const scenario of SCENARIOS) {
  test(`boot: ${scenario.name}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL })
    if (scenario.signedIn) {
      const email = freshEmail()
      await createVerifiedUser(email)
      await logIn(await context.newPage(), email)
    }
    await screencast(await context.newPage(), scenario.name, scenario.url, scenario.ready)
    await context.close()
  })
}
