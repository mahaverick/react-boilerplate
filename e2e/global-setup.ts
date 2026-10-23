import { chromium, type FullConfig } from '@playwright/test'

/** Harness routes whose lazy chunks a cold dev server would otherwise transform mid-test. */
const WARM_PATHS = ['/dashboard', '/login']

/**
 * Loads the harness once before any test, so Vite has bundled its dependencies
 * and transformed the entry and the first route chunks.
 *
 * `webServer` is ready as soon as `/` answers, which is before the dev
 * server's first optimizer pass and module transforms have finished. With four
 * workers on a cold server, the first tests would wait on that work inside
 * their 5 s assertion budget.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  if (process.env.E2E_NGINX || process.env.E2E_CAPTURE) return
  const baseURL = config.projects.find((project) => project.name === 'fixtures')?.use.baseURL
  if (!baseURL)
    throw new Error("globalSetup: no 'fixtures' project with a baseURL in playwright.config.ts")
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ baseURL })
    for (const path of WARM_PATHS) {
      await page.goto(`/e2e/harness/?path=${path}`)
      await page.locator('h1').first().waitFor({ timeout: 60_000 })
    }
  } finally {
    await browser.close()
  }
}
