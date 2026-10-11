/**
 * @file The Content-Security-Policy and security headers `nginx.conf` sends,
 * as the nginx e2e tests expect them, and helpers that collect CSP violations
 * from a page.
 */
import type { Page } from '@playwright/test'
import { afterPageTask } from '../timing'

/** The policy `nginx.conf` sends when the response carries none of its own, character for character. */
export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"

/** Every security header `nginx.conf` sets on its server block, with the value it sends when the response carries none of its own. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
}

/**
 * Collects every CSP violation `page` reports after this call, across
 * navigations, into the returned list, which keeps filling. The listener is an init script, so it
 * is in place before any of a document's own scripts run. Console errors naming
 * the policy are collected as well.
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
const APP_ORIGIN = process.env.E2E_NGINX_ORIGIN ?? 'http://localhost:8088'

/** Fails fast, with the command to run, when no container is serving. */
export async function requireServedApp(): Promise<void> {
  const served = await fetch(APP_ORIGIN).catch(() => null)
  if (!served?.ok) {
    throw new Error(
      `No app at ${APP_ORIGIN}. Build and run the image: docker build -t react-boilerplate:e2e . && docker run -d --name rb-e2e -p 8088:8080 --read-only --tmpfs /tmp --add-host=api:127.0.0.1 -e POSTHOG_KEY=phc_test_key_not_real -e APP_ENVIRONMENT=ci -e ANALYTICS_HANDOFF_ORIGINS=https://www.example.test react-boilerplate:e2e`
    )
  }
}

/**
 * Waits for one round trip to the page, so a violation the page queued before it
 * has reached the list. Call it before asserting on the list.
 */
export async function flushCspReports(page: Page): Promise<void> {
  await afterPageTask(page)
}
