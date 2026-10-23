import { defineConfig, devices } from '@playwright/test'

/**
 * The e2e projects.
 *
 * `fixtures` runs against the MSW harness in `e2e/harness/` and needs only a
 * preview of its build. It holds the rendered checks jsdom cannot make, because jsdom has
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
/** The origin the server answers on; `E2E_BASE_URL` points the run at another one. */
const port = process.env.REACT_E2E_PORT ?? '5173'
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.test.ts',
  // live, contrast and capture run serially; nginx runs in parallel only in ci.yml's `docker` job (see its project).
  fullyParallel: false,
  // The total cap. Projects set their own, lower or equal: fixtures 4 under CI, nginx 4 in the `docker` job, the rest 1.
  workers: process.env.CI ? 4 : '50%',
  forbidOnly: !!process.env.CI,
  /** Under CI, ci.yml's e2e job uploads the html report from playwright-report/ when it fails. */
  reporter: process.env.CI ? [['github'], ['dot'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    // CI runs no retries, so on-first-retry would record nothing there; screenshots are off because recording them for every test slowed the run.
    trace: process.env.CI ? { mode: 'retain-on-failure', screenshots: false } : 'on-first-retry',
  },
  /**
   * Starts a server. Skipped for the `nginx` project, which serves the
   * production bundle from a container; `webServer` has no per-project form, so
   * the switch is an env var.
   *
   * `pnpm test:e2e` sets `E2E_BUNDLED` and runs `fixtures` against a build of
   * the harness in development mode, previewed (e2e/harness.vite.config.ts): a
   * few files per page instead of the dev server's hundreds of modules. `live`
   * and `contrast` need the dev server and its proxy, so they start `vp dev`.
   * A bundled run always builds and serves its own copy, so it fails with
   * "already used" while another server holds the port: stop it, or set
   * `REACT_E2E_PORT`. Outside CI, a dev server that is already running is
   * reused. `E2E_CAPTURE` turns the server off as well: the capture runs
   * against a dev stack that is already up.
   */
  webServer:
    process.env.E2E_NGINX || process.env.E2E_CAPTURE
      ? undefined
      : {
          command: process.env.E2E_BUNDLED
            ? `pnpm exec vp build --mode development --config e2e/harness.vite.config.ts && pnpm exec vp preview --config e2e/harness.vite.config.ts --port ${port} --strictPort`
            : `pnpm exec vp dev --force --port ${port} --strictPort`,
          env: { NODE_ENV: 'development' },
          url: `${baseURL}/e2e/harness/`,
          reuseExistingServer: !process.env.CI && !process.env.E2E_BUNDLED,
          // Under CI the server's log goes to the job log.
          stdout: process.env.CI ? 'pipe' : 'ignore',
          timeout: 120_000,
        },
  projects: [
    {
      name: 'fixtures',
      testMatch: 'fixtures/**/*.test.ts',
      // The MSW harness has no shared backend, so each test gets its own page and worker.
      fullyParallel: true,
      // Four workers, one per vCPU on a 4 vCPU runner. Against the dev server, pages stalled past the 5 s assertion budget at four; against the bundle, three runs in a row passed.
      workers: process.env.CI ? 4 : '50%',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'live',
      fullyParallel: false,
      workers: 1,
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
      fullyParallel: false,
      workers: 1,
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
      fullyParallel: false,
      workers: 1,
      testMatch: 'capture/**/*.test.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      timeout: 30 * 60_000,
    },
    /**
     * Against the production image. The SSE reconnect is only observable here:
     * the Vite proxy does not propagate an upstream close, and nginx does. The
     * headers and the CSP are only real here too; those tests are tagged
     * `@no-api`, and ci.yml's `docker` job runs them with `--grep @no-api`.
     */
    {
      name: 'nginx',
      // Only ci.yml's `docker` job (CI, no E2E_LIVE) runs the stateless @no-api tests in parallel; a live run shares one backend and one fake PostHog port.
      fullyParallel: !!process.env.CI && !process.env.E2E_LIVE,
      workers: process.env.CI && !process.env.E2E_LIVE ? 4 : 1,
      testMatch: 'nginx/**/*.test.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.E2E_NGINX_ORIGIN ?? 'http://localhost:8088',
      },
    },
  ],
})
