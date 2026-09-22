import { z } from 'zod'
import { MEMBERSHIP_ROLES } from '@/constants/roles'
import { emailSchema } from '@/schemas/auth.schemas'

/**
 * Mirrors `tenant.validators.ts` on the server, field for field, so a form
 * rejects locally exactly what the API would reject remotely. Every ceiling
 * below is the width of the column the value is written to — over-long input
 * is a Postgres 22001 (a 500), not a 400, if it reaches the database.
 */
const MAX_TENANT_NAME_LENGTH = 255
const MAX_TENANT_DESCRIPTION_LENGTH = 1000
const MAX_TENANT_LOGO_LENGTH = 255
const MAX_TENANT_WEBSITE_LENGTH = 255
const MAX_TENANT_TIMEZONE_LENGTH = 64
const MAX_TENANT_LOCALE_LENGTH = 10
const MIN_SLUG_LENGTH = 3
const MAX_SLUG_LENGTH = 100

/**
 * Slugs no tenant may register. Verbatim from `RESERVED_SLUGS`
 * (tenant.constants.ts) — they either collide with a plausible route
 * segment, would mislead as an organization's public identifier, or are a
 * string masquerading as something else.
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
] as const

// A Set, not the tuple's own `.includes`: `ReadonlyArray<T>.includes` wants
// its argument assignable to the literal union, which a parsed `string` is
// not. Same fix the backend's own validator applies to the same tuple.
const RESERVED = new Set<string>(RESERVED_SLUGS)

/**
 * A tenant's URL-safe identifier.
 *
 * `.trim()` but deliberately NOT `.toLowerCase()`, unlike `emailSchema`.
 * Mixed case is REJECTED, not normalised: the slug is a routing identifier
 * (`/tenants/:slug`), so silently rewriting "MyOrg" to "myorg" would address
 * a different tenant than the one the user typed and let them believe they
 * registered a string the database does not hold.
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

/**
 * An optional text field on a CREATE body: blank means "not given".
 *
 * The backend's own `.min(1)` on these fields rejects `''`, and an untouched
 * text input submits exactly that — so the empty string is turned into
 * `undefined` (dropping the key from the payload) rather than posted. The
 * same shape `nameSchema` in auth.schemas.ts already uses.
 */
function optionalText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters.`)
    .transform((value) => (value === '' ? undefined : value))
    .optional()
}

/**
 * The same field on a PATCH body, where the backend takes three states:
 * omitted leaves the column alone, an explicit `null` CLEARS it, a string
 * sets it. A cleared input therefore sends `null` — `undefined` would be
 * "leave it as it was", and the user who emptied the box would watch their
 * old description come back.
 */
function clearableText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters.`)
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
    .max(MAX_TENANT_NAME_LENGTH, `Name must be at most ${MAX_TENANT_NAME_LENGTH} characters.`),
  slug: slugSchema,
  description: optionalText(MAX_TENANT_DESCRIPTION_LENGTH, 'Description'),
  logo: optionalText(MAX_TENANT_LOGO_LENGTH, 'Logo'),
  website: optionalText(MAX_TENANT_WEBSITE_LENGTH, 'Website'),
})

export type NewTenantInput = z.infer<typeof newTenantSchema>

/**
 * `PATCH /tenants/:slug`.
 *
 * `slug` IS DELIBERATELY ABSENT — `updateTenantSchema` on the server omits
 * it too. It is this tenant's URL identity: every bookmark, every
 * `resolveTenant` lookup and this endpoint's own route param would have to
 * change in lockstep with a rename. A rename flow is real product work, not
 * a field on this form.
 */
export const updateTenantSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required.')
    .max(MAX_TENANT_NAME_LENGTH, `Name must be at most ${MAX_TENANT_NAME_LENGTH} characters.`)
    .optional(),
  description: clearableText(MAX_TENANT_DESCRIPTION_LENGTH, 'Description'),
  logo: clearableText(MAX_TENANT_LOGO_LENGTH, 'Logo'),
  website: clearableText(MAX_TENANT_WEBSITE_LENGTH, 'Website'),
})

export type UpdateTenantInput = z.infer<typeof updateTenantSchema>

/**
 * `POST /tenants/:slug/members`. `role` is required, not defaulted — this is
 * an owner or admin consciously granting access. WHICH roles may be offered
 * is `canActorGrantRole`'s job (constants/roles.ts), not a schema's: a
 * schema knows the shape of a role, never who is asking.
 */
export const addMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(MEMBERSHIP_ROLES),
})

export type AddMemberInput = z.infer<typeof addMemberSchema>

/** `PATCH /tenants/:slug/members/:userId`. */
export const updateMemberRoleSchema = z.object({ role: z.enum(MEMBERSHIP_ROLES) })

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>

/**
 * `PATCH /tenants/:slug/settings`.
 *
 * `timezone` and `locale` are bounded to their column widths only. The
 * backend deliberately does not check that a value is a real IANA zone or
 * BCP 47 tag, and neither does this — a mirror that rejected more than the
 * API does would be a different contract.
 */
export const updateTenantSettingsSchema = z.object({
  timezone: optionalText(MAX_TENANT_TIMEZONE_LENGTH, 'Timezone'),
  locale: optionalText(MAX_TENANT_LOCALE_LENGTH, 'Locale'),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
})

export type UpdateTenantSettingsInput = z.infer<typeof updateTenantSettingsSchema>

/**
 * `metadata` as the settings form actually holds it: JSON in a textarea.
 *
 * Blank clears the column (`null`, which the API accepts), and anything that
 * is not a JSON OBJECT is refused here rather than at the API — the column
 * takes an object, so a bare array, number or string would come back as a
 * 400 with no field attached.
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
 * What the settings FORM validates: the same three fields, with `metadata`
 * arriving as text. Its output is exactly `UpdateTenantSettingsInput`, so
 * the page parses once and posts the result.
 *
 * `timezone` and `locale` are REQUIRED here, where the PATCH body above has
 * them optional. Both columns are NOT NULL with a default, and the form is
 * always populated with their current values — so an emptied box cannot
 * mean "clear it" and must not quietly mean "leave it alone" either. As
 * `optionalText`, a blank timezone would drop out of the payload, the server
 * would keep the old value, and the user would be told "Settings updated."
 * while watching the value they deleted come straight back.
 */
export const tenantSettingsFormSchema = z.object({
  timezone: z
    .string()
    .trim()
    .min(1, 'Timezone is required.')
    .max(
      MAX_TENANT_TIMEZONE_LENGTH,
      `Timezone must be at most ${MAX_TENANT_TIMEZONE_LENGTH} characters.`
    ),
  locale: z
    .string()
    .trim()
    .min(1, 'Locale is required.')
    .max(
      MAX_TENANT_LOCALE_LENGTH,
      `Locale must be at most ${MAX_TENANT_LOCALE_LENGTH} characters.`
    ),
  metadata: metadataTextSchema,
})
