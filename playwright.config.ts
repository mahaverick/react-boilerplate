import { defineConfig, devices } from '@playwright/test'

/**
 * The e2e projects.
 *
 * `fixtures` runs against the MSW harness in `e2e/harness/` and needs only the
 * dev server. It holds the rendered checks jsdom cannot make, because jsdom has
 * no layout: the member table scrolls rather than crushing, the webfont loads,
 * the empty state says something.
 *
 * `live` runs against a real express-boilerplate (`E2E_API_ORIGIN`, default
 * :4040) through the Vite proxy, and is skipped unless `E2E_LIVE=1`. It covers
 * what needs a real server, cookie jar and reload: a reload keeps you signed in
 * and the refresh cookie carries the path and flags the SPA assumes, its
 * `Secure` flag set by express's `COOKIE_SECURE` (default from `APP_ENV`),
 * which no `X-Forwarded-Proto` header changes.
 *
 * Tests are `*.test.ts`, not Playwright's default `*.spec.ts`, which
 * `check-file/filename-blocklist` rejects.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.test.ts',
  // Tests share one dev server and backend, so one test's sign-out would break another.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  /** Under CI, ci.yml's e2e job uploads the html report from playwright-report/ when it fails. */
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  /**
   * Starts the dev server, reusing a running one outside CI. Skipped for the
   * `nginx` project, which serves the production bundle from a container;
   * `webServer` has no per-project form, so the switch is an env var.
   */
  webServer: process.env.E2E_NGINX
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
  projects: [
    {
      name: 'fixtures',
      testMatch: 'fixtures/**/*.test.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'live',
      testMatch: 'live/**/*.test.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    /**
     * Colour contrast, which jsdom cannot compute (no layout), so the unit a11y
     * gate disables every colour rule. Opt-in and not run in CI: run
     * `pnpm test:contrast` before merging UI work, since component composition
     * can break contrast as well as a palette change.
     */
    {
      name: 'contrast',
      testMatch: 'contrast/**/*.test.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    /**
     * Against the production image. The SSE reconnect is only observable here:
     * the Vite proxy does not propagate an upstream close, and nginx does. The
     * headers and the CSP are only real here too; those tests are tagged
     * `@no-api`, and CI runs them with `--grep @no-api`.
     */
    {
      name: 'nginx',
      testMatch: 'nginx/**/*.test.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.E2E_NGINX_ORIGIN ?? 'http://localhost:8088',
      },
    },
  ],
})
