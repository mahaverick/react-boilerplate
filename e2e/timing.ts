import type { Locator, Page } from '@playwright/test'

export { settle } from '../tests/fixtures/timing'

/**
 * Waits in the page for every webfont to load, then for two animation frames,
 * so text has reflowed onto its final background before anything samples it.
 */
export async function afterFontsAndFrames(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve()
        })
      })
    })
  })
}

/**
 * Waits for every finite animation on `element` and its descendants to finish,
 * so a popup is sampled at its settled colours rather than mid-fade.
 * Infinite ones (a spinner) are skipped; they never finish.
 */
export async function afterAnimations(element: Locator): Promise<void> {
  await element.evaluate(async (node) => {
    const finite = node
      .getAnimations({ subtree: true })
      .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)))
  })
}

/**
 * Waits for one task to run in the page, so anything the page queued before
 * it (a `securitypolicyviolation` report, say) has been delivered.
 */
export async function afterPageTask(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)))
}
