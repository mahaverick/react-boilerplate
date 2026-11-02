import { DATE_TIME_WITH_ZONE } from '@/lib/format'

/** Largest first, so the first unit that fits is the one used. */
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
]

/**
 * "3 minutes ago", "yesterday" or "in 2 hours", in the reader's own locale;
 * "less than a minute ago" (or "in less than a minute") within 45 seconds and
 * "at an unknown time" for a date that does not parse. `now` is for tests.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'at an unknown time'
  const seconds = Math.round((then - now) / 1000)
  const withinAMinute = seconds > 0 ? 'in less than a minute' : 'less than a minute ago'
  if (Math.abs(seconds) < 45) return withinAMinute
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit)
  }
  return withinAMinute
}

/**
 * The exact instant, in the reader's locale and time zone, with the zone's
 * name ("2 Nov 2026, 3:42 pm IST"): the tooltip beside a relative time.
 */
export function absoluteTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Unknown time'
  return new Intl.DateTimeFormat(undefined, DATE_TIME_WITH_ZONE).format(date)
}
