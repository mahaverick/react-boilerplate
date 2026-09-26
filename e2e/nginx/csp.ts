import type { Page } from '@playwright/test'

/** The policy nginx.conf sends, character for character. */
export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"

/** Every security header nginx.conf sets on its server block, with its exact value. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
}

/**
 * Collects every CSP violation on `page` from now on, across navigations. The
 * listener is an init script, so it is in place before any of a document's own
 * scripts run. Console errors naming the policy are collected as well.
 */
export async function watchCspViolations(page: Page): Promise<string[]> {
  const violations: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('Content Security Policy')) {
      violations.push(message.text())
    }
  })
  await page.exposeFunction('reportCspViolation', (violation: string) => {
    violations.push(violation)
  })
  await page.addInitScript(() => {
    document.addEventListener(
      'securitypolicyviolation',
      (event) => {
        const report = (window as unknown as { reportCspViolation: (v: string) => Promise<void> })
          .reportCspViolation
        void report(`${event.effectiveDirective} blocked ${event.blockedURI || 'inline'}`)
      },
      true
    )
  })
  return violations
}

/** Where the nginx project's container is expected to be serving. */
export const APP_ORIGIN = process.env.E2E_NGINX_ORIGIN ?? 'http://localhost:8088'

/** Fails fast, with the command to run, when no container is serving. */
export async function requireServedApp(): Promise<void> {
  const served = await fetch(APP_ORIGIN).catch(() => null)
  if (!served?.ok) {
    throw new Error(
      `No app at ${APP_ORIGIN}. Build and run the image: docker build -t react-boilerplate:e2e . && docker run -d --name rb-e2e -p 8088:8080 --read-only --tmpfs /tmp --add-host=api:127.0.0.1 react-boilerplate:e2e`
    )
  }
}

/**
 * Waits for one round trip to the page, so a violation report sent before it
 * has reached the test. Call it before asserting on the collected list.
 */
export async function flushCspReports(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)))
}
