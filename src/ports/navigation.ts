/**
 * @file The navigation port: leaving the app's current page. Each app writes
 * its own copy; shared files never read `window.location`.
 */

/**
 * Loads `url` as a full page, ending the current document.
 * @param url - The same-origin path or URL to load.
 */
export function assignLocation(url: string): void {
  window.location.assign(url)
}
