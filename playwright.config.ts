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
/** The origin the dev server answers on; `E2E_BASE_URL` points the run at another one. */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.test.ts',
  // live and nginx share one backend or container, so they run serially.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  /** Under CI, ci.yml's e2e job uploads the html report from playwright-report/ when it fails. */
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  /**
   * Starts the dev server, reusing a running one outside CI. Skipped for the
   * `nginx` project, which serves the production bundle from a container;
   * `webServer` has no per-project form, so the switch is an env var.
   * `E2E_CAPTURE` turns it off as well: the capture runs against a dev stack
   * that is already up.
   */
  webServer:
    process.env.E2E_NGINX || process.env.E2E_CAPTURE
      ? undefined
      : {
          command: 'pnpm dev',
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
  projects: [
    {
      name: 'fixtures',
      testMatch: 'fixtures/**/*.test.ts',
      // The MSW harness has no shared backend, so each test gets its own page and worker.
      fullyParallel: true,
      workers: process.env.CI ? 4 : '50%',
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
     * The page inventory's screenshots (docs/pages/). Opt-in, never in CI: it
     * runs against an already-running dev stack and starts nothing, so
     * `E2E_CAPTURE` also turns `webServer` off. Run `pnpm capture:pages`.
     */
    {
      name: 'capture',
      testMatch: 'capture/**/*.test.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      timeout: 30 * 60_000,
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
