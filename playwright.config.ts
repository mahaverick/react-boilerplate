import { defineConfig, devices } from '@playwright/test'

/**
 * Two projects, because the e2e suite answers two different questions.
 *
 * `fixtures` runs against the MSW harness in `e2e/harness/`. It needs nothing
 * but the dev server, so it is the one that can run anywhere, and it is where
 * the rendered checks live — the ones jsdom cannot make, because it has no
 * layout: does the member table actually scroll rather than crush itself, does
 * the webfont actually load, does the empty state actually say something.
 *
 * `live` runs against a real express-boilerplate on :4040 through the Vite
 * proxy, and is SKIPPED unless `E2E_LIVE=1`. It exists for the three
 * behaviours in `docs/superpowers/decisions/2026-09-22-open-items.md` §1 that
 * no amount of unit testing substitutes for: a reload keeps you signed in, the
 * SSE stream reconnects after a real backend restart, and the refresh cookie
 * carries the flags the SPA assumes — its `Secure` flag set by express's
 * `COOKIE_SECURE` (default from `APP_ENV`), which no `X-Forwarded-Proto`
 * header changes. Each needs a real server, a real cookie jar and a real
 * reload.
 *
 * Tests are `*.test.ts`, NOT Playwright's default `*.spec.ts`:
 * `check-file/filename-blocklist` rejects `.spec.` across this repo, so the
 * default would fail lint on the first file.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.test.ts',
  // These drive a shared dev server and a shared backend; running them at once
  // means one test's sign-out is another's mystery failure.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  // Reuses a dev server you already have running; starts one otherwise.
  //
  // Skipped entirely for the `nginx` project, which serves the PRODUCTION
  // bundle out of a container and has no use for Vite. `webServer` is a
  // top-level option with no per-project form, so the switch is an env var.
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
    // Colour contrast, which jsdom cannot compute at all — it has no layout and
    // no cascade, so the unit a11y gate disables every colour rule. Opt-in:
    // contrast is a property of the palette and moves rarely.
    {
      name: 'contrast',
      testMatch: 'contrast/**/*.test.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // Against the production image, not the dev server. The SSE reconnect is
    // only observable here: the Vite proxy does not propagate an upstream
    // close, so the browser never learns the stream died. nginx does. The
    // headers and the CSP are only real here too; those tests are tagged
    // `@no-api` and CI runs them with `--grep @no-api`.
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
