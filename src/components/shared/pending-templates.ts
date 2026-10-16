import { lazyRouteComponent } from '@tanstack/react-router'

/**
 * The route pending templates, each a lazy wrapper over `page-skeleton` so the
 * templates stay out of the entry chunk (pnpm check:bundle). This module is not
 * split from the routes that name its exports, and every wrapper is fetched at
 * startup (`templatesReady`): the router does not preload a template, and one still loading when
 * a navigation passes `defaultPendingMs` would suspend to an ancestor and replace
 * its whole layout with that ancestor's fallback.
 */
const template = (name: string) =>
  lazyRouteComponent(() => import('@/components/shared/page-skeleton'), name as 'ListPending')

/** The router-wide pending template: a list page. */
export const ListPending = template('ListPending')
/** A detail layout route's pending template. */
export const DetailPending = template('DetailPending')
/** A tab's pending template, under a detail layout that draws the heading and tabs. */
export const DetailTabPending = template('DetailTabPending')
/** A dashboard route's pending template. */
export const DashboardPending = template('DashboardPending')
/** The settings layout's pending template. */
export const SettingsPending = template('SettingsPending')
/** A settings page's pending template, under the settings layout's own heading. */
export const SettingsPagePending = template('SettingsPagePending')
/** An auth page's pending template: the sign-in card's shape. */
export const AuthPending = template('AuthPending')

/** Every template, for the startup preload. */
const ALL = [
  ListPending,
  DetailPending,
  DetailTabPending,
  DashboardPending,
  SettingsPending,
  SettingsPagePending,
  AuthPending,
]

/**
 * Fetches every template's chunk, then once more for each that failed. The wrapper's
 * `preload` never rejects: a failed import is latched and `preload` stays a function
 * (a success sets it to `undefined`), so a function left over is the failure signal,
 * and calling it again imports again. Never rejects itself: a template that still
 * fails shows its error when it renders. Whether the browser fetches the module again
 * after a failure depends on how it caches failed module fetches.
 */
async function preloadAll(): Promise<void> {
  await Promise.allSettled(ALL.map(async (template) => template.preload?.()))
  const failed = ALL.filter((template) => typeof template.preload === 'function')
  await Promise.allSettled(failed.map(async (template) => template.preload?.()))
}

/**
 * Settles once every template's chunk has loaded (or failed twice). Started when
 * this module loads; `main.tsx` waits on it beside `router.load()`, so the first
 * render, including a page held before its own route's template is known, never
 * suspends on a template.
 */
export const templatesReady: Promise<void> = preloadAll()

/**
 * The longest the first render waits for the templates. A chunk fetch that hangs
 * without failing would otherwise keep the boot shell up for good; after this the
 * app mounts and a template that has still not loaded behaves as it did before the
 * preload (it suspends until it lands). `router.load()` is not capped here: the
 * flags read inside it has its own cap.
 */
export const TEMPLATES_WAIT_MS = 3000

/** Settles when `templatesReady` does, or after `TEMPLATES_WAIT_MS`, whichever is first. */
export function waitForTemplates(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, TEMPLATES_WAIT_MS)
    void templatesReady.then(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}
