import { describe, expect, it } from 'vite-plus/test'
import { formatBillingDate, formatInr, perMonthOfYearly } from '@/lib/billing-format'

describe('formatInr', () => {
  it('formats paise as whole rupees with Indian grouping', () => {
    expect(formatInr(99_900)).toBe('₹999')
    expect(formatInr(999_000)).toBe('₹9,990')
    expect(formatInr(10_000_000)).toBe('₹1,00,000')
  })
})

describe('perMonthOfYearly', () => {
  it('divides a yearly price by 12, rounded to the rupee', () => {
    expect(perMonthOfYearly(999_000)).toBe('₹833')
  })
})

describe('formatBillingDate', () => {
  it('spells the month out, in UTC when no time zone is given', () => {
    expect(formatBillingDate('2026-11-02T10:00:00.000Z')).toBe('2 November 2026')
  })

  it('reads the day in the tenant’s time zone, as the server does', () => {
    // Razorpay's cycles end at 18:30Z, which is midnight in India.
    expect(formatBillingDate('2026-11-01T18:30:00.000Z', 'Asia/Kolkata')).toBe('2 November 2026')
    expect(formatBillingDate('2026-11-01T18:30:00.000Z', 'UTC')).toBe('1 November 2026')
  })

  it('reads an unknown time zone as UTC', () => {
    expect(formatBillingDate('2026-11-01T18:30:00.000Z', 'Mars/Olympus')).toBe('1 November 2026')
  })

  it('returns an empty string for a value that is not a date', () => {
    expect(formatBillingDate('not a date', 'Asia/Kolkata')).toBe('')
  })
})
