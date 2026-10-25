/**
 * @file Razorpay Checkout's script under the production policy. It loads the
 * script the way `loadRazorpay()` in `src/lib/razorpay-checkout.ts` does: the
 * bundle does not export that function, and `script-src` matches the script's
 * URL whoever adds the tag. Opening Checkout needs a checkout session from a
 * live API, so the live Checkout walk checks the rest of the Razorpay hosts.
 *
 * Not `@no-api`, so CI's `nginx-e2e` shards never run it: it fetches from
 * Razorpay's servers (checkout.razorpay.com, and the scripts and frame
 * checkout.js loads), which serve checkout.js unversioned, so their outage or
 * change would fail a PR with no change of ours. Only live nginx runs
 * (`E2E_LIVE=1`: the nightly and `pnpm test:e2e:nginx`) run it.
 */
import { expect, test } from '@playwright/test'
import { afterFontsAndFrames } from '../timing'
import {
  CONTENT_SECURITY_POLICY,
  flushCspReports,
  requireServedApp,
  watchCspViolations,
} from './csp'

test.skip(
  process.env.E2E_LIVE !== '1',
  "needs Razorpay's servers — set E2E_LIVE=1 (pnpm test:e2e:nginx)"
)

test.beforeEach(requireServedApp)

/** `SCRIPT_SRC` in `src/lib/razorpay-checkout.ts`, which its unit test pins too. */
const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

test("Razorpay Checkout's script loads under the policy with no violation", async ({ page }) => {
  const violations = await watchCspViolations(page)
  const response = await page.goto('/login')
  expect(response?.headers()['content-security-policy']).toBe(CONTENT_SECURITY_POLICY)
  await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible()

  const loaded = await page.evaluate(
    (src) =>
      new Promise<string>((resolve) => {
        const script = document.createElement('script')
        script.src = src
        script.async = true
        script.addEventListener('load', () => {
          resolve(typeof (window as unknown as { Razorpay?: unknown }).Razorpay)
        })
        script.addEventListener('error', () => {
          resolve('error')
        })
        document.head.append(script)
      }),
    SCRIPT_SRC
  )
  expect(loaded).toBe('function')

  // The script may fetch or frame more once it runs; wait for the fonts and one page task so a late violation reaches the list.
  await afterFontsAndFrames(page)
  await flushCspReports(page)
  expect(violations).toEqual([])
})
