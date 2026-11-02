/**
 * @file Page titles analytics sends in place of the ones shown. A page whose
 * tab title carries customer text (a workspace's name) registers the title it
 * shows and the one to send instead; `before_send` swaps them in every event's
 * `title` and `$title`. Kept apart from the SDK code so a page chunk can
 * register a title without loading posthog-js.
 */

/** Each title shown, mapped to the title sent in its place. Never cleared: a page view can be captured after its page has gone. */
const sentInPlaceOf = new Map<string, string>()

/**
 * Sends `sent` wherever analytics would send `shown` as a page title.
 * @param shown - The document title the tab shows.
 * @param sent - The title to send instead, without the customer text.
 */
export function sendTitleAs(shown: string, sent: string): void {
  sentInPlaceOf.set(shown, sent)
}

/**
 * The event's properties with each registered title, under `title` or
 * `$title` (where posthog-js puts the document title), swapped for the one
 * to send.
 * @param properties - An event's properties.
 * @returns A copy, or the same object when no property holds a registered title.
 */
export function withSentTitles(properties: Record<string, unknown>): Record<string, unknown> {
  let swapped = properties
  for (const key of ['title', '$title']) {
    const sent = sentInPlaceOf.get(properties[key] as string)
    if (sent !== undefined) swapped = { ...swapped, [key]: sent }
  }
  return swapped
}
