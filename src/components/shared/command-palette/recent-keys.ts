/**
 * @file The palette's recents storage key, kept apart from the recents
 * module so signing out can clear every list without importing the palette,
 * its schema or zod.
 */

/** The `localStorage` key prefix of the palette's recents; the user id follows it. */
export const RECENT_KEY_PREFIX = 'palette.recent.v1:'

/** Removes every stored recents list, whoever's; blocked storage has none to remove. */
export function clearAllRecents(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(RECENT_KEY_PREFIX)) localStorage.removeItem(key)
    }
  } catch {
    // Nothing was stored, or storage is blocked.
  }
}
