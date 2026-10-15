/**
 * @file Holds, fails or stubs API requests on a page, so the capture can shoot
 * a route's loading, error and empty states against the real dev stack. Only
 * matched requests are touched; every other request continues untouched.
 */
import type { Page, Route } from '@playwright/test'
import { matchesEndpoint, parseEndpoint, type Endpoint } from './endpoint'
import type { LoadingUi, Stub } from './types'

/** What to do with the requests a rule matches. */
export type Rule =
  | { action: 'hold'; endpoints: readonly string[] }
  | { action: 'fail'; endpoints: readonly string[]; status: number }
  | { action: 'stub'; stubs: readonly Stub[] }

/** A rule set installed on a page. */
export interface Control {
  /** Settles when the first matched request arrives. */
  seen: Promise<void>
  /** Lets every held request continue. */
  release(): void
  /** Releases held requests and removes the handler. */
  dispose(): Promise<void>
}

/** Matches /api/v1 on any origin: the dev proxy serves it on the app's own. */
const API_URL = /\/api\/v1\//

/**
 * Installs `rules` on `page`. The first rule that matches a request decides it.
 * @param page - The page about to navigate.
 * @param rules - Hold, fail or stub rules.
 * @returns The installed control: wait on `seen`, `release` held requests, `dispose` when done.
 */
export async function controlRequests(page: Page, rules: readonly Rule[]): Promise<Control> {
  const parsed = rules.map((rule) =>
    rule.action === 'stub'
      ? { rule, endpoints: rule.stubs.map((stub) => parseEndpoint(stub.endpoint)) }
      : { rule, endpoints: rule.endpoints.map(parseEndpoint) }
  )
  /** Settles `seen`; replaced by the promise's resolver. */
  let markSeen = () => {}
  const seen = new Promise<void>((resolve) => {
    markSeen = resolve
  })
  /** Settles `released`; replaced by the promise's resolver. */
  let releaseHeld = () => {}
  const released = new Promise<void>((resolve) => {
    releaseHeld = resolve
  })

  /**
   * Decides one API request: continue, hold, fail or stub it.
   * @param route - The intercepted request.
   */
  const handler = async (route: Route) => {
    const request = route.request()
    const hit = parsed.find(({ endpoints }) =>
      endpoints.some((endpoint: Endpoint) =>
        matchesEndpoint(endpoint, request.method(), request.url())
      )
    )
    if (!hit) return route.continue()
    markSeen()
    const { rule } = hit
    if (rule.action === 'hold') {
      await released
      return route.continue().catch(() => undefined)
    }
    if (rule.action === 'fail') {
      return route.fulfill({
        status: rule.status,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          message: 'Captured failure',
          statusCode: rule.status,
        }),
      })
    }
    const stub = rule.stubs.find((candidate) =>
      matchesEndpoint(parseEndpoint(candidate.endpoint), request.method(), request.url())
    )
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: 'OK', statusCode: 200, data: stub?.data }),
    })
  }

  await page.route(API_URL, handler)
  return {
    seen,
    release: releaseHeld,
    dispose: async () => {
      releaseHeld()
      await page.unroute(API_URL, handler)
    },
  }
}

/**
 * Waits up to 5 s for loading UI and names what appeared first: a shadcn
 * `Skeleton` (`data-slot="skeleton"`), a `role=status` spinner, or index.html's
 * boot splash. `'none'` when nothing did.
 * @param page - A page with a held request.
 * @returns The kind of loading UI found.
 */
export async function waitForLoadingUi(page: Page): Promise<LoadingUi> {
  const candidates: [LoadingUi, string][] = [
    ['splash', '.boot-splash'],
    ['skeleton', '[data-slot="skeleton"]'],
    ['spinner', '[role="status"]'],
  ]
  const found = await Promise.any(
    candidates.map(([name, selector]) =>
      page
        .locator(selector)
        .first()
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => name)
    )
  ).catch(() => 'none' as const)
  return found
}
