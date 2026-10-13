/**
 * The product name: the suffix of every page title and the heading of the
 * signed-out pages' brand panel. A derived project changes it here.
 */
export const APP_NAME = 'React Boilerplate'

/** The one line under the app name on the signed-out pages' brand panel. */
export const APP_TAGLINE = 'Multi-tenant workspaces, ready to build on.'

/** A page's document title: `Profile` becomes `Profile · React Boilerplate`. */
export function pageTitle(page: string): string {
  return `${page} · ${APP_NAME}`
}
