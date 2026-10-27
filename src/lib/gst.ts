// Shared with apex byte for byte. Import nothing app-specific here.

/** A selectable GST state or territory. */
export interface GstState {
  code: string
  name: string
}

const GSTIN_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

/**
 * The 37 selectable states and territories in code order. Codes 25 and 28 are
 * retired and 99 is not a place of supply, so none of them is listed.
 */
export const GST_STATES: readonly GstState[] = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
  { code: '97', name: 'Other Territory' },
]

/** Finds a selectable state by its two-digit code. */
export function stateOf(code: string): GstState | undefined {
  return GST_STATES.find((s) => s.code === code)
}

/** Trims and upper-cases a GSTIN as typed. */
export function normaliseGstin(raw: string): string {
  return raw.trim().toUpperCase()
}

/** Computes the check character of a GSTIN's first 14 characters (mod-36). */
export function gstinCheckCharacter(first14: string): string {
  let sum = 0
  for (let index = 0; index < 14; index++) {
    const product = GSTIN_ALPHABET.indexOf(first14.charAt(index)) * (index % 2 === 0 ? 1 : 2)
    sum += Math.floor(product / 36) + (product % 36)
  }
  return GSTIN_ALPHABET.charAt((36 - (sum % 36)) % 36)
}

/** Names the first rule a normalised GSTIN breaks, or null when it passes. */
export function gstinProblem(gstin: string): 'shape' | 'checksum' | 'state' | null {
  if (!GSTIN_PATTERN.test(gstin)) return 'shape'
  if (stateOf(gstin.slice(0, 2)) === undefined) return 'state'
  if (gstinCheckCharacter(gstin.slice(0, 14)) !== gstin.charAt(14)) return 'checksum'
  return null
}
