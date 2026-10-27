import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vite-plus/test'
import {
  ADDRESS_REQUIRED_MESSAGE,
  CITY_REQUIRED_MESSAGE,
  GSTIN_CHECKSUM_MESSAGE,
  GSTIN_SHAPE_MESSAGE,
  GSTIN_STATE_CODE_MESSAGE,
  LEGAL_NAME_REQUIRED_MESSAGE,
  PINCODE_MESSAGE,
  PINCODE_REQUIRED_MESSAGE,
  SEZ_NEEDS_GSTIN_MESSAGE,
  STATE_REQUIRED_MESSAGE,
  STATE_UNKNOWN_MESSAGE,
  TAX_DETAILS_SAVED_MESSAGE,
  TAX_DETAILS_UNCHANGED_MESSAGE,
  TEXT_PATTERN_MESSAGE,
  gstinStateMismatchMessage,
  maxLengthMessage,
  normaliseQuotes,
  taxDetailsForm,
  taxDetailsFieldsSchema,
  taxDetailsRuleIssues,
  valuesFrom,
  type TaxDetailsForm,
  type TaxDetailsValues,
} from '@/schemas/tax-details.schemas'
import { testTaxDetails } from '@/tests/fixtures/tax'

const FORM: TaxDetailsForm = {
  gstin: '',
  legalName: 'Acme Traders Private Limited',
  addressLine1: '',
  addressLine2: '',
  city: '',
  pincode: '',
  stateCode: '29',
  isSez: false,
}

/**
 * Parses a form with some fields replaced.
 * @param overrides - Fields to replace.
 * @returns The safeParse result.
 */
function parse(overrides: Partial<TaxDetailsForm>) {
  return taxDetailsFieldsSchema.safeParse({ ...FORM, ...overrides })
}

/**
 * The first message on a field, or undefined.
 * @param overrides - Fields to replace.
 * @param path - The field to read.
 * @returns The message.
 */
function messageOn(overrides: Partial<TaxDetailsForm>, path: keyof TaxDetailsForm) {
  return parse(overrides).error?.issues.find((issue) => issue.path[0] === path)?.message
}

const MERGED: TaxDetailsValues = {
  gstin: '27ABCDE1234F1Z0',
  legalName: 'Acme',
  addressLine1: '12 MG Road',
  addressLine2: null,
  city: 'Pune',
  pincode: '411001',
  stateCode: '29',
  isSez: false,
}

describe('GC 3.1 messages', () => {
  it('copies the contract word for word', () => {
    expect(LEGAL_NAME_REQUIRED_MESSAGE).toBe('Enter the legal name to print on your tax invoices.')
    expect(maxLengthMessage(100)).toBe('Use 100 characters or fewer.')
    expect(TEXT_PATTERN_MESSAGE).toBe('Use English letters, digits and common punctuation.')
    expect(GSTIN_SHAPE_MESSAGE).toBe('Enter the 15-character GSTIN, such as 29ABCDE1234F1ZW.')
    expect(GSTIN_CHECKSUM_MESSAGE).toBe(
      "This GSTIN's last character doesn't match the rest. Check it against your registration certificate."
    )
    expect(GSTIN_STATE_CODE_MESSAGE).toBe("This GSTIN's first two digits aren't a state code.")
    expect(gstinStateMismatchMessage('Goa')).toBe(
      'This GSTIN is registered in Goa. Choose Goa as the state.'
    )
    expect(ADDRESS_REQUIRED_MESSAGE).toBe(
      'Enter address line 1. Invoices with a GSTIN need your registered address.'
    )
    expect(CITY_REQUIRED_MESSAGE).toBe('Enter the city. Invoices with a GSTIN need it.')
    expect(PINCODE_REQUIRED_MESSAGE).toBe(
      'Enter the 6-digit PIN code. Invoices with a GSTIN need it.'
    )
    expect(STATE_REQUIRED_MESSAGE).toBe(
      'Choose the state of your billing address. It sets the tax split on your invoices.'
    )
    expect(STATE_UNKNOWN_MESSAGE).toBe('Choose a state from the list.')
    expect(PINCODE_MESSAGE).toBe('Enter the 6-digit PIN code.')
    expect(SEZ_NEEDS_GSTIN_MESSAGE).toBe('An SEZ unit has a GSTIN. Enter it first.')
    expect(TAX_DETAILS_UNCHANGED_MESSAGE).toBe('Change at least one tax detail before saving.')
    expect(TAX_DETAILS_SAVED_MESSAGE).toBe(
      'Tax details saved. They apply to invoices issued from now on.'
    )
  })

  it('keeps TAX_TEXT_PATTERN free of raw non-ASCII characters', () => {
    const source = readFileSync('src/schemas/tax-details.schemas.ts', 'utf8')
    const line = source.split('\n').find((l) => l.includes('export const TAX_TEXT_PATTERN'))
    expect(line).toBeDefined()
    expect([...(line ?? '')].every((char) => char.charCodeAt(0) < 128)).toBe(true)
  })
})

describe('taxDetailsFieldsSchema', () => {
  it('names a wrong GSTIN check character', () => {
    expect(messageOn({ gstin: '29ABCDE1234F1ZX' }, 'gstin')).toBe(GSTIN_CHECKSUM_MESSAGE)
  })

  it('names an unknown state code ahead of the checksum', () => {
    expect(messageOn({ gstin: '25ABCDE1234F1Z4' }, 'gstin')).toBe(GSTIN_STATE_CODE_MESSAGE)
    expect(messageOn({ gstin: '99ABCDE1234F1ZP' }, 'gstin')).toBe(GSTIN_STATE_CODE_MESSAGE)
  })

  it('names a wrong GSTIN shape', () => {
    expect(messageOn({ gstin: '29ABCDE1234F1Z' }, 'gstin')).toBe(GSTIN_SHAPE_MESSAGE)
  })

  it('upper-cases and trims a GSTIN', () => {
    expect(parse({ gstin: ' 29abcde1234f1zw ' }).data?.gstin).toBe('29ABCDE1234F1ZW')
  })

  it('turns blank optional fields into null', () => {
    expect(parse({}).data).toEqual({
      gstin: null,
      legalName: 'Acme Traders Private Limited',
      addressLine1: null,
      addressLine2: null,
      city: null,
      pincode: null,
      stateCode: '29',
      isSez: false,
    })
  })

  it('requires a state that the list knows', () => {
    expect(messageOn({ stateCode: '' }, 'stateCode')).toBe(STATE_REQUIRED_MESSAGE)
    expect(messageOn({ stateCode: '25' }, 'stateCode')).toBe(STATE_UNKNOWN_MESSAGE)
  })

  it('rejects a malformed PIN code', () => {
    expect(messageOn({ pincode: '012345' }, 'pincode')).toBe(PINCODE_MESSAGE)
    expect(messageOn({ pincode: '56001' }, 'pincode')).toBe(PINCODE_MESSAGE)
    expect(parse({ pincode: '560001' }).data?.pincode).toBe('560001')
  })

  it('checks the legal name', () => {
    expect(messageOn({ legalName: 'नमस्ते' }, 'legalName')).toBe(TEXT_PATTERN_MESSAGE)
    expect(messageOn({ legalName: '  ' }, 'legalName')).toBe(LEGAL_NAME_REQUIRED_MESSAGE)
    expect(messageOn({ legalName: 'a'.repeat(101) }, 'legalName')).toBe(
      'Use 100 characters or fewer.'
    )
    expect(messageOn({ legalName: 'a'.repeat(100) }, 'legalName')).toBeUndefined()
  })

  it('caps the city at 60 and address lines at 100', () => {
    expect(messageOn({ city: 'c'.repeat(61) }, 'city')).toBe('Use 60 characters or fewer.')
    expect(messageOn({ addressLine1: 'a'.repeat(101) }, 'addressLine1')).toBe(
      'Use 100 characters or fewer.'
    )
    expect(messageOn({ addressLine2: 'a'.repeat(101) }, 'addressLine2')).toBe(
      'Use 100 characters or fewer.'
    )
  })

  it('accepts Latin-1 text, curls quotes straight, and lets a formula through', () => {
    expect(parse({ legalName: 'Café Ltd' }).data?.legalName).toBe('Café Ltd')
    expect(parse({ legalName: 'O’Brien Ltd' }).data?.legalName).toBe("O'Brien Ltd")
    expect(parse({ legalName: '“Acme”' }).data?.legalName).toBe('"Acme"')
    expect(parse({ legalName: '=SUM(A1)' }).data?.legalName).toBe('=SUM(A1)')
    expect(normaliseQuotes('‘a’')).toBe("'a'")
  })

  it('runs no cross-field rule', () => {
    expect(parse({ gstin: '29ABCDE1234F1ZW', isSez: true }).success).toBe(true)
    expect(parse({ isSez: true }).success).toBe(true)
  })
})

describe('taxDetailsRuleIssues', () => {
  it('flags a GSTIN state that differs from the chosen state', () => {
    expect(taxDetailsRuleIssues(MERGED, new Set(['stateCode']))).toEqual([
      {
        path: 'stateCode',
        message: 'This GSTIN is registered in Maharashtra. Choose Maharashtra as the state.',
      },
    ])
  })

  it('leaves a stored mismatch alone when an unrelated field changed', () => {
    expect(taxDetailsRuleIssues(MERGED, new Set(['city']))).toEqual([])
  })

  it('skips the state match for a stored GSTIN with a retired state code', () => {
    const merged = { ...MERGED, gstin: '25ABCDE1234F1Z4' }
    expect(taxDetailsRuleIssues(merged, new Set(['stateCode']))).toEqual([])
  })

  it('needs address fields with a GSTIN', () => {
    const merged = { ...MERGED, stateCode: '27', city: null, addressLine1: null, pincode: null }
    expect(taxDetailsRuleIssues(merged, new Set(['gstin']))).toEqual([
      { path: 'addressLine1', message: ADDRESS_REQUIRED_MESSAGE },
      { path: 'city', message: CITY_REQUIRED_MESSAGE },
      { path: 'pincode', message: PINCODE_REQUIRED_MESSAGE },
    ])
    expect(taxDetailsRuleIssues(merged, new Set(['legalName']))).toEqual([])
  })

  it('needs a GSTIN for an SEZ unit', () => {
    const merged = { ...MERGED, gstin: null, isSez: true }
    expect(taxDetailsRuleIssues(merged, new Set(['isSez']))).toEqual([
      { path: 'isSez', message: SEZ_NEEDS_GSTIN_MESSAGE },
    ])
    expect(taxDetailsRuleIssues(merged, new Set(['city']))).toEqual([])
  })
})

describe('valuesFrom and taxDetailsForm', () => {
  it('maps a stored row without validating it', () => {
    const stored = testTaxDetails({ gstin: '29ABCDE1234F1ZX' })
    expect(valuesFrom(stored)).toEqual({
      gstin: '29ABCDE1234F1ZX',
      legalName: stored.legalName,
      addressLine1: stored.addressLine1,
      addressLine2: null,
      city: stored.city,
      pincode: stored.pincode,
      stateCode: '29',
      isSez: false,
    })
  })

  it('gives blanks for no stored row', () => {
    expect(taxDetailsForm(null)).toEqual({
      gstin: '',
      legalName: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      pincode: '',
      stateCode: '',
      isSez: false,
    })
  })

  it('round-trips a stored row through the schema', () => {
    const stored = testTaxDetails()
    expect(taxDetailsFieldsSchema.parse(taxDetailsForm(stored))).toEqual(valuesFrom(stored))
  })
})
