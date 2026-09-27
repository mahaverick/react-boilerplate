/** The product name, and the suffix of every page title. */
export const APP_NAME = 'React Boilerplate'

/** A page's document title: `Profile` becomes `Profile · React Boilerplate`. */
export function pageTitle(page: string): string {
  return `${page} · ${APP_NAME}`
}
