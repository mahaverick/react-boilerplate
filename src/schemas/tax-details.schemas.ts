// Shared with apex byte for byte. Import nothing app-specific here.
/**
 * @file The tax-details form schema, copying the API's validation strings from
 * the contract's validation messages word for word. The schema holds per-field rules
 * only, because `changedFieldsOf` skips object-level refinements; the
 * cross-field rules are `taxDetailsRuleIssues`, run on the merged values.
 */
import '@/lib/zod-jitless'
import { z } from 'zod'
import { gstinProblem, normaliseGstin, stateOf } from '@/lib/gst'

/** The stored buyer details, as `GET /billing/tax-details` sends them. */
export interface TaxDetails {
  gstin: string | null
  legalName: string
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  pincode: string | null
  state: { code: string; name: string }
  isSez: boolean
}

/** The tax details as the API takes them: blank optional fields are `null`. */
export interface TaxDetailsValues {
  gstin: string | null
  legalName: string
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  pincode: string | null
  stateCode: string
  isSez: boolean
}

/** A blank legal name. */
export const LEGAL_NAME_REQUIRED_MESSAGE = 'Enter the legal name to print on your tax invoices.'
/** A character outside the text pattern. */
export const TEXT_PATTERN_MESSAGE = 'Use English letters, digits and common punctuation.'
/** A GSTIN of the wrong shape. */
export const GSTIN_SHAPE_MESSAGE = 'Enter the 15-character GSTIN, such as 29ABCDE1234F1ZW.'
/** A GSTIN whose check character is wrong. */
export const GSTIN_CHECKSUM_MESSAGE =
  "This GSTIN's last character doesn't match the rest. Check it against your registration certificate."
/** A GSTIN whose first two digits are no state. */
export const GSTIN_STATE_CODE_MESSAGE = "This GSTIN's first two digits aren't a state code."
/** A GSTIN with no address line 1. */
export const ADDRESS_REQUIRED_MESSAGE =
  'Enter address line 1. Invoices with a GSTIN need your registered address.'
/** A GSTIN with no city. */
export const CITY_REQUIRED_MESSAGE = 'Enter the city. Invoices with a GSTIN need it.'
/** A GSTIN with no PIN code. */
export const PINCODE_REQUIRED_MESSAGE = 'Enter the 6-digit PIN code. Invoices with a GSTIN need it.'
/** No state chosen. */
export const STATE_REQUIRED_MESSAGE =
  'Choose the state of your billing address. It sets the tax split on your invoices.'
/** A state code outside the list. */
export const STATE_UNKNOWN_MESSAGE = 'Choose a state from the list.'
/** A malformed PIN code. */
export const PINCODE_MESSAGE = 'Enter the 6-digit PIN code.'
/** An SEZ unit with no GSTIN. */
export const SEZ_NEEDS_GSTIN_MESSAGE = 'An SEZ unit has a GSTIN. Enter it first.'
/** A save that changes nothing. */
export const TAX_DETAILS_UNCHANGED_MESSAGE = 'Change at least one tax detail before saving.'
/** The success message of a save. */
export const TAX_DETAILS_SAVED_MESSAGE =
  'Tax details saved. They apply to invoices issued from now on.'

const MAX_LINE_LENGTH = 100
const MAX_CITY_LENGTH = 60
const GSTIN_REQUIRED_FIELDS = [
  ['addressLine1', ADDRESS_REQUIRED_MESSAGE],
  ['city', CITY_REQUIRED_MESSAGE],
  ['pincode', PINCODE_REQUIRED_MESSAGE],
] as const
const GSTIN_PROBLEM_MESSAGES = {
  shape: GSTIN_SHAPE_MESSAGE,
  state: GSTIN_STATE_CODE_MESSAGE,
  checksum: GSTIN_CHECKSUM_MESSAGE,
}
const PINCODE_PATTERN = /^[1-9][0-9]{5}$/

/**
 * Builds the message for a field over its length ceiling.
 * @param max - The ceiling, in characters.
 * @returns The message.
 */
export function maxLengthMessage(max: number): string {
  return `Use ${max} characters or fewer.`
}

/**
 * Builds the message for a GSTIN whose state differs from the chosen state.
 * @param stateName - The GSTIN's state.
 * @returns The message.
 */
export function gstinStateMismatchMessage(stateName: string): string {
  return `This GSTIN is registered in ${stateName}. Choose ${stateName} as the state.`
}

/** Printable ASCII, Latin-1 and curly quotes, written as escapes so the source stays ASCII. */
export const TAX_TEXT_PATTERN = /^[\x20-\x7E\xA0-\xFF\u2018\u2019\u201C\u201D]*$/

/**
 * Turns curly quotes into straight ones, as express does before its check.
 * @param value - The text.
 * @returns The text with U+2018/U+2019 as `'` and U+201C/U+201D as `"`.
 */
export function normaliseQuotes(value: string): string {
  return value.replaceAll(/[\u2018\u2019]/g, "'").replaceAll(/[\u201C\u201D]/g, '"')
}

/**
 * A trimmed, quote-normalised text field that is `null` when blank.
 * @param max - The ceiling, in characters.
 * @returns The field schema.
 */
function optionalText(max: number) {
  return z.string().transform((raw, ctx): string | null => {
    const value = normaliseQuotes(raw.trim())
    if (value === '') return null
    if (!TAX_TEXT_PATTERN.test(value)) {
      ctx.addIssue({ code: 'custom', message: TEXT_PATTERN_MESSAGE })
      return z.NEVER
    }
    if (value.length > max) {
      ctx.addIssue({ code: 'custom', message: maxLengthMessage(max) })
      return z.NEVER
    }
    return value
  })
}

/** The form's fields, each checked on its own. */
export const taxDetailsFieldsSchema = z.object({
  gstin: z.string().transform((raw, ctx): string | null => {
    const value = normaliseGstin(raw)
    if (value === '') return null
    const problem = gstinProblem(value)
    if (problem === null) return value
    ctx.addIssue({ code: 'custom', message: GSTIN_PROBLEM_MESSAGES[problem] })
    return z.NEVER
  }),
  legalName: optionalText(MAX_LINE_LENGTH).transform((value, ctx): string => {
    if (value !== null) return value
    ctx.addIssue({ code: 'custom', message: LEGAL_NAME_REQUIRED_MESSAGE })
    return z.NEVER
  }),
  addressLine1: optionalText(MAX_LINE_LENGTH),
  addressLine2: optionalText(MAX_LINE_LENGTH),
  city: optionalText(MAX_CITY_LENGTH),
  pincode: z.string().transform((raw, ctx): string | null => {
    const value = raw.trim()
    if (value === '') return null
    if (PINCODE_PATTERN.test(value)) return value
    ctx.addIssue({ code: 'custom', message: PINCODE_MESSAGE })
    return z.NEVER
  }),
  stateCode: z.string().transform((raw, ctx): string => {
    const value = raw.trim()
    if (value === '') {
      ctx.addIssue({ code: 'custom', message: STATE_REQUIRED_MESSAGE })
      return z.NEVER
    }
    if (stateOf(value) === undefined) {
      ctx.addIssue({ code: 'custom', message: STATE_UNKNOWN_MESSAGE })
      return z.NEVER
    }
    return value
  }),
  isSez: z.boolean(),
})

/** What the form holds while it is edited: every text field is a string. */
export type TaxDetailsForm = z.input<typeof taxDetailsFieldsSchema>

/**
 * Applies the three cross-field rules to the merged values, as express does. A
 * rule runs only when the save changed one of its fields, so a stored value that
 * breaks a rule never blocks an unrelated correction. On the first save pass
 * every field. With a GSTIN: when gstin or stateCode changed, a prefix that is
 * no selectable state is flagged on gstin, and a state that differs from the
 * chosen one on stateCode; when gstin, addressLine1, city or pincode changed,
 * every missing one of addressLine1, city and pincode is flagged.
 * @param merged - The stored values with the changed fields laid over them.
 * @param changed - The fields this save sends.
 * @returns One issue per broken rule, on the field to show it under.
 */
export function taxDetailsRuleIssues(
  merged: TaxDetailsValues,
  changed: ReadonlySet<keyof TaxDetailsValues>
): Array<{ path: keyof TaxDetailsValues; message: string }> {
  const issues: Array<{ path: keyof TaxDetailsValues; message: string }> = []
  /** Whether this save changed any of the fields. */
  const touched = (...fields: Array<keyof TaxDetailsValues>) =>
    fields.some((field) => changed.has(field))
  const { gstin } = merged

  if (gstin !== null && touched('gstin', 'stateCode')) {
    const gstinState = stateOf(gstin.slice(0, 2))
    if (gstinState === undefined) {
      issues.push({ path: 'gstin', message: GSTIN_STATE_CODE_MESSAGE })
    } else if (gstinState.code !== merged.stateCode) {
      issues.push({ path: 'stateCode', message: gstinStateMismatchMessage(gstinState.name) })
    }
  }
  if (gstin !== null && touched('gstin', 'addressLine1', 'city', 'pincode')) {
    for (const [field, message] of GSTIN_REQUIRED_FIELDS) {
      if (merged[field] === null) issues.push({ path: field, message })
    }
  }
  if (merged.isSez && gstin === null && touched('isSez', 'gstin')) {
    issues.push({ path: 'isSez', message: SEZ_NEEDS_GSTIN_MESSAGE })
  }
  return issues
}

/**
 * Maps stored details to API values with no validation, so a stored value that
 * today's rules refuse can still be a merge base.
 * @param details - The stored details.
 * @returns The values.
 */
export function valuesFrom(details: TaxDetails): TaxDetailsValues {
  return {
    gstin: details.gstin,
    legalName: details.legalName,
    addressLine1: details.addressLine1,
    addressLine2: details.addressLine2,
    city: details.city,
    pincode: details.pincode,
    stateCode: details.state.code,
    isSez: details.isSez,
  }
}

/**
 * The form's starting values.
 * @param details - The stored details, or `null` before the first save.
 * @returns Blanks for `null`; otherwise the stored values with `null` as `''`.
 */
export function taxDetailsForm(details: TaxDetails | null): TaxDetailsForm {
  if (details === null) {
    return {
      gstin: '',
      legalName: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      pincode: '',
      stateCode: '',
      isSez: false,
    }
  }
  return {
    gstin: details.gstin ?? '',
    legalName: details.legalName,
    addressLine1: details.addressLine1 ?? '',
    addressLine2: details.addressLine2 ?? '',
    city: details.city ?? '',
    pincode: details.pincode ?? '',
    stateCode: details.state.code,
    isSez: details.isSez,
  }
}
