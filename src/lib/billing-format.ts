/**
 * @file Money and dates on billing surfaces, written the way the API writes
 * them in its messages, so a server sentence and a UI line beside it agree.
 */

/** Whole rupees with Indian digit grouping: `₹9,990`, `₹1,00,000`. */
const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

/**
 * An amount in rupees, rounded to the rupee.
 * @param amountMinor - The amount in paise, as the API sends it.
 * @returns For example `₹999` for 99900.
 */
export function formatInr(amountMinor: number): string {
  return INR.format(amountMinor / 100)
}

/**
 * What a yearly price comes to each month, rounded to the rupee.
 * @param amountMinor - The yearly amount in paise.
 * @returns For example `₹833` for 999000.
 */
export function perMonthOfYearly(amountMinor: number): string {
  return formatInr(amountMinor / 12)
}

/**
 * A billing date as the workspace's people read it: the day, the month's
 * name and the year, in the workspace's time zone. Express formats the dates
 * in its billing messages the same way, so both name the same day. An unknown
 * zone reads as UTC, as on the server.
 * @param iso - The moment, as an ISO 8601 string.
 * @param timeZone - The tenant's `timezone` setting; `UTC` when it has none.
 * @returns For example "2 November 2026", or an empty string when `iso` is not a date.
 */
export function formatBillingDate(iso: string, timeZone = 'UTC'): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  try {
    return dateInZone(date, timeZone)
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    return dateInZone(date, 'UTC')
  }
}

/**
 * The date in one zone, month spelled out.
 * @param date - A valid moment.
 * @param timeZone - An IANA zone name; an unknown one throws `RangeError`.
 * @returns For example "2 November 2026".
 */
function dateInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

/**
 * Each invoice status express sends, in plain words. express folds
 * Razorpay's `partially_paid` into `issued`, so a partly paid invoice reads
 * "Not paid".
 */
const INVOICE_STATUS_LABEL: Readonly<Record<string, string>> = {
  paid: 'Paid',
  issued: 'Not paid',
  expired: 'Expired',
  cancelled: 'Cancelled',
}

/**
 * An invoice status as the invoices table says it: "Not paid" for `issued`,
 * and any status it does not know written out ("payment_due" → "Payment due").
 * @param status - The status the API sent.
 */
export function invoiceStatusLabel(status: string): string {
  const known = INVOICE_STATUS_LABEL[status]
  if (known !== undefined) return known
  const words = status.replaceAll('_', ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
