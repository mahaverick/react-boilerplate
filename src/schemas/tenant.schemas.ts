/**
 * @file The tenant form schemas, mirroring the API's tenant.validators.ts
 * field for field so a form rejects locally what the API would reject. Each
 * ceiling is its column's width: over-long input reaching the database is a
 * Postgres 22001 (a 500), not a 400.
 */
import { z } from 'zod'
import { MEMBERSHIP_ROLES } from '@/constants/roles'
import { emailSchema } from '@/schemas/auth.schemas'
import { normalizeMultilineText, notAllowedMessage, safeText } from '@/schemas/safe-text.schemas'

const MAX_TENANT_NAME_LENGTH = 255
const MAX_TENANT_DESCRIPTION_LENGTH = 1000
const MAX_TENANT_LOGO_LENGTH = 255
const MAX_TENANT_WEBSITE_LENGTH = 255
const MAX_TENANT_TIMEZONE_LENGTH = 64
const MAX_TENANT_LOCALE_LENGTH = 10
const MIN_SLUG_LENGTH = 3
const MAX_SLUG_LENGTH = 100

/**
 * Slugs no tenant may register, mirroring the API's `RESERVED_SLUGS`
 * (tenant.constants.ts). Each collides with a plausible route segment, would
 * mislead as an organization's identifier, or masquerades as another value.
 */
export const RESERVED_SLUGS = [
  'admin',
  'api',
  'app',
  'auth',
  'login',
  'logout',
  'register',
  'signin',
  'signup',
  'settings',
  'billing',
  'support',
  'help',
  'docs',
  'status',
  'health',
  'static',
  'assets',
  'public',
  'cdn',
  'www',
  'mail',
  'ftp',
  'blog',
  'about',
  'contact',
  'terms',
  'privacy',
  'dashboard',
  'root',
  'system',
  'null',
  'undefined',
  'true',
  'false',
  'new',
  'edit',
  'delete',
  'create',
  'update',
  'tenants',
  'tenant',
  'users',
  'user',
  'members',
  'owner',
  'me',
  'test',
  'staging',
  'dev',
  'localhost',
  'platform',
] as const

/** A Set, because the tuple's `.includes` rejects a plain `string` argument. */
const RESERVED = new Set<string>(RESERVED_SLUGS)

/**
 * A tenant's URL-safe identifier. Trimmed, but mixed case is rejected rather
 * than lowercased: the slug is a routing identifier (`/tenants/:slug`), and
 * rewriting "MyOrg" to "myorg" would register a string the user did not type.
 */
export const slugSchema = z
  .string()
  .trim()
  .min(MIN_SLUG_LENGTH, `Slug must be at least ${MIN_SLUG_LENGTH} characters.`)
  .max(MAX_SLUG_LENGTH, `Slug must be at most ${MAX_SLUG_LENGTH} characters.`)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    'Slug must be lowercase letters, numbers and hyphens, and cannot start or end with a hyphen.'
  )
  .refine((slug) => !RESERVED.has(slug), 'This slug is reserved and cannot be used.')

/** Which of the API's `safeText` checks a field gets. Absent means none. */
type SafeTextMode = 'single-line' | 'multiline'

/**
 * A trimmed string capped at `max`. With `safe`, it also refuses what the
 * API's `safeText` refuses, after turning `\r\n` into `\n` on a multiline field.
 */
function boundedText(max: number, label: string, safe?: SafeTextMode) {
  const multiline = safe === 'multiline'
  const field = multiline ? z.string().overwrite(normalizeMultilineText) : z.string()
  const bounded = field.trim().max(max, `${label} must be at most ${max} characters.`)
  return safe ? bounded.refine(safeText({ multiline }), notAllowedMessage(label)) : bounded
}

/**
 * An optional text field on a create body, where blank means "not given": the
 * API's `.min(1)` rejects `''`, which an untouched input submits, so `''`
 * becomes `undefined` and drops out of the payload.
 */
function optionalText(max: number, label: string, safe?: SafeTextMode) {
  return boundedText(max, label, safe)
    .transform((value) => (value === '' ? undefined : value))
    .optional()
}

/**
 * The same field on a PATCH body, where the API takes three states: omitted
 * leaves the column alone, `null` clears it, a string sets it. A cleared input
 * sends `null`, since `undefined` would keep the old value.
 */
function clearableText(max: number, label: string, safe?: SafeTextMode) {
  return boundedText(max, label, safe)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional()
}

/** `POST /tenants`. The caller becomes the tenant's sole owner. */
export const newTenantSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required.')
    .max(MAX_TENANT_NAME_LENGTH, `Name must be at most ${MAX_TENANT_NAME_LENGTH} characters.`)
    .refine(safeText(), notAllowedMessage('Name')),
  slug: slugSchema,
  description: optionalText(MAX_TENANT_DESCRIPTION_LENGTH, 'Description', 'multiline'),
  logo: optionalText(MAX_TENANT_LOGO_LENGTH, 'Logo', 'single-line'),
  website: optionalText(MAX_TENANT_WEBSITE_LENGTH, 'Website', 'single-line'),
})

export type NewTenantInput = z.infer<typeof newTenantSchema>

/**
 * `PATCH /tenants/:slug`. No `slug`, as on the server: it is the tenant's URL
 * identity, which bookmarks and every lookup depend on.
 */
export const updateTenantSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required.')
    .max(MAX_TENANT_NAME_LENGTH, `Name must be at most ${MAX_TENANT_NAME_LENGTH} characters.`)
    .refine(safeText(), notAllowedMessage('Name'))
    .optional(),
  description: clearableText(MAX_TENANT_DESCRIPTION_LENGTH, 'Description', 'multiline'),
  logo: clearableText(MAX_TENANT_LOGO_LENGTH, 'Logo', 'single-line'),
  website: clearableText(MAX_TENANT_WEBSITE_LENGTH, 'Website', 'single-line'),
})

export type UpdateTenantInput = z.infer<typeof updateTenantSchema>

/**
 * `POST /tenants/:slug/invitations`. `role` is required, not defaulted. Which
 * roles may be offered is `canActorGrantRole`'s job, since a schema never
 * knows who is asking.
 */
export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(MEMBERSHIP_ROLES),
})

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>

/** `PATCH /tenants/:slug/members/:userId`. */
export const updateMemberRoleSchema = z.object({ role: z.enum(MEMBERSHIP_ROLES) })

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>

/** A time zone name's letters, digits and `_+-/`, as the API checks first. */
const TIMEZONE_PATTERN = /^[A-Za-z0-9_+\-/]+$/

/** A BCP 47 language tag's common shape (`en`, `en-GB`, `zh-Hant-TW`), as the API checks first. */
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

/**
 * Whether `value` names a time zone this browser knows (an IANA name such as
 * `Europe/Paris`, an alias such as `UTC`, or `Etc/GMT+5`), in the
 * letters-digits-`_+-/` shape, as the API's `isTimeZoneName` checks it. Names
 * match case-insensitively, and a colon-free UTC offset (`+0530`) is a name to
 * `Intl`; the colon form `+05:30` fails the shape check.
 * @param value - The trimmed candidate.
 * @returns True when the value is a usable time zone name.
 */
function isTimeZoneName(value: string): boolean {
  if (!TIMEZONE_PATTERN.test(value)) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/**
 * Whether `value` is a BCP 47 language tag of the common shape that `Intl`
 * accepts, as the API's `isLocaleTag` checks it.
 * @param value - The trimmed candidate.
 * @returns True when the value is a usable locale tag.
 */
function isLocaleTag(value: string): boolean {
  if (!LOCALE_PATTERN.test(value)) return false
  try {
    return Intl.getCanonicalLocales(value).length === 1
  } catch {
    return false
  }
}

/** The timezone field: trimmed, capped, `safeText`, and a known time zone name, with the API's messages. */
function timezoneText() {
  return z
    .string()
    .trim()
    .max(
      MAX_TENANT_TIMEZONE_LENGTH,
      `Timezone must be at most ${MAX_TENANT_TIMEZONE_LENGTH} characters.`
    )
    .refine(safeText(), notAllowedMessage('Timezone'))
    .refine(
      (value) => value === '' || isTimeZoneName(value),
      'Timezone must be a time zone name such as Europe/Paris.'
    )
}

/** The locale field: trimmed, capped, `safeText`, and a BCP 47 tag, with the API's messages. */
function localeText() {
  return z
    .string()
    .trim()
    .max(MAX_TENANT_LOCALE_LENGTH, `Locale must be at most ${MAX_TENANT_LOCALE_LENGTH} characters.`)
    .refine(safeText(), notAllowedMessage('Locale'))
    .refine(
      (value) => value === '' || isLocaleTag(value),
      'Locale must be a language tag such as en or en-US.'
    )
}

/**
 * `PATCH /tenants/:slug/settings`. `timezone` must name a time zone and
 * `locale` must be a BCP 47 tag, both within their column widths, as the API
 * checks them.
 */
export const updateTenantSettingsSchema = z.object({
  timezone: timezoneText()
    .transform((value) => (value === '' ? undefined : value))
    .optional(),
  locale: localeText()
    .transform((value) => (value === '' ? undefined : value))
    .optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
})

export type UpdateTenantSettingsInput = z.infer<typeof updateTenantSettingsSchema>

/**
 * `metadata` as the settings form holds it: JSON in a textarea. Blank clears
 * the column (`null`). Anything but a JSON object is refused here, because the
 * API would answer a bare array, number or string with a 400.
 */
export const metadataTextSchema = z.string().transform((text, ctx) => {
  const trimmed = text.trim()
  if (trimmed === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Metadata must be valid JSON.' })
    return z.NEVER
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    ctx.addIssue({ code: 'custom', message: 'Metadata must be a JSON object.' })
    return z.NEVER
  }
  return parsed as Record<string, unknown>
})

/**
 * What the settings form validates: the same three fields, with `metadata` as
 * text; its output is `UpdateTenantSettingsInput`. `timezone` and `locale` are
 * required here, unlike the PATCH body: both columns are NOT NULL, so an
 * emptied box cannot clear them, and dropping it from the payload would
 * report "Settings updated." while keeping the old value.
 */
export const tenantSettingsFormSchema = z.object({
  timezone: timezoneText().refine((value) => value !== '', 'Timezone is required.'),
  locale: localeText().refine((value) => value !== '', 'Locale is required.'),
  metadata: metadataTextSchema,
})
