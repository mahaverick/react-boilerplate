/**
 * A date in the reader's own locale, or `null` when `iso` is not a date.
 * Callers pick the style and supply their own fallback text.
 */
export function formatDate(iso: string, dateStyle: 'medium' | 'long'): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, { dateStyle }).format(date)
}

/**
 * A date and time with the zone's short name. `dateStyle` and `timeStyle`
 * cannot be combined with `timeZoneName`, so the parts are spelled out.
 */
export const DATE_TIME_WITH_ZONE: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
}

/**
 * A date and time in the reader's own locale and time zone, with the zone's
 * name ("2 Nov 2026, 3:42 pm IST"), or `null` when `iso` is not a date.
 */
export function formatDateTime(iso: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, DATE_TIME_WITH_ZONE).format(date)
}

/** The name parts a person may have on file. */
export interface NameParts {
  firstName?: string | null
  lastName?: string | null
}

/** "Ada Lovelace" from its trimmed parts, or `null` when neither has any text. */
export function fullName(person: NameParts | null | undefined): string | null {
  const parts = [person?.firstName?.trim(), person?.lastName?.trim()].filter(
    (part): part is string => Boolean(part)
  )
  return parts.length > 0 ? parts.join(' ') : null
}
