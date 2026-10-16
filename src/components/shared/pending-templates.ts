import { lazyRouteComponent } from '@tanstack/react-router'

/**
 * The route pending templates, each a lazy wrapper over `page-skeleton` so the
 * templates stay out of the entry chunk (pnpm check:bundle). This module is not
 * split from the routes that name its exports, and every wrapper is fetched here,
 * at startup: the router does not preload a template, and one still loading when
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

for (const loaded of [
  ListPending,
  DetailPending,
  DetailTabPending,
  DashboardPending,
  SettingsPending,
  SettingsPagePending,
]) {
  void loaded.preload?.()
}
