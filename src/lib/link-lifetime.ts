/**
 * @file How the copy states an emailed link's lifetime and expiry, from the
 * figures express serves (`GET /status/client-settings`, the step-up request's
 * `expiresAt`). Lifetimes round as express's mail rounds them, so the page and
 * the email name the same figure: links in minutes, invitations in days.
 */

/** Seconds in a minute and in a day. */
const SECONDS_PER_MINUTE = 60
const SECONDS_PER_DAY = 86_400

/**
 * A link lifetime in minutes, rounded to the nearest and at least 1, as the
 * sign-in and step-up mail write it: "15 minutes", "1 minute".
 * @param seconds - The lifetime in seconds.
 */
export function inMinutes(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / SECONDS_PER_MINUTE))
  return minutes === 1 ? '1 minute' : `${String(minutes)} minutes`
}

/**
 * An invitation lifetime in whole days, rounded up, as the invitation mail
 * writes it: "3 days", "1 day".
 * @param seconds - The lifetime in seconds.
 */
export function inDays(seconds: number): string {
  const days = Math.max(1, Math.ceil(seconds / SECONDS_PER_DAY))
  return days === 1 ? '1 day' : `${String(days)} days`
}

/**
 * The rules of a mailed sign-in link: it works once, and its lifetime when
 * the settings are in. Without them the sentence states no figure.
 * @param seconds - `signInLinkTtlSeconds`, or undefined while unknown.
 */
export function linkRules(seconds: number | undefined): string {
  return seconds === undefined
    ? 'The link works once.'
    : `The link works once and expires in ${inMinutes(seconds)}.`
}

/**
 * When a link expires, as a date and time with its zone named: "3 November
 * 2026 at 10:15 GMT+5:30". The month is spelled out, so the day reads the
 * same in every locale.
 * @param iso - An ISO timestamp, or undefined from an API that sends none.
 * @param timeZone - An IANA zone; the reader's own when omitted.
 * @returns The text, or null when there is no valid time.
 */
export function formatExpiry(iso: string | undefined, timeZone?: string): string | null {
  if (iso === undefined) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date)
}
