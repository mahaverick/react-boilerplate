import { describe, expect, it } from 'vite-plus/test'
import { trialSummary } from '@/lib/trial-summary'
import { testEntitlements, testPlans } from '@/tests/fixtures/billing'
import type { PublicPlan, TenantEntitlements } from '@/types/billing.types'

const FREE = testPlans.plans.find((plan) => plan.key === 'free') as PublicPlan
const PAID = testPlans.plans.find((plan) => plan.key === 'paid') as PublicPlan

/**
 * The entitlements after the trial: the effective plan is Free, so the
 * features read Free's values and members are limited to 3.
 * @param used - How many members the workspace has.
 * @param overrides - Fields to replace.
 */
function afterTrial(used: number, overrides: Partial<TenantEntitlements> = {}): TenantEntitlements {
  return testEntitlements({
    plan: { key: 'free', name: 'Free' },
    state: 'free',
    features: { advanced_example: false },
    limits: { members: { limit: 3, used, approaching: false } },
    ...overrides,
  })
}

describe('trialSummary', () => {
  it('lists a limit the workspace is over, with the label in lower case, then the Paid-only feature', () => {
    expect(trialSummary(afterTrial(5), FREE, PAID, testPlans.catalog)).toEqual([
      { key: 'members', label: 'Members', line: '5 members (Free allows 3)' },
      { key: 'advanced_example', label: 'Insights', line: 'Insights (Paid only)' },
    ])
  })

  it('shows only the Paid-only feature line when usage fits Free', () => {
    expect(trialSummary(afterTrial(3), FREE, PAID, testPlans.catalog)).toEqual([
      { key: 'advanced_example', label: 'Insights', line: 'Insights (Paid only)' },
    ])
  })

  it('lists nothing when usage fits Free and Paid has no feature Free lacks', () => {
    const free = { entitlements: { members: 3, advanced_example: true } }
    expect(trialSummary(afterTrial(2), free, PAID, testPlans.catalog)).toEqual([])
  })

  it('compares with the plans while the entitlements still read Paid', () => {
    const trialing = testEntitlements({
      limits: { members: { limit: null, used: 5, approaching: false } },
    })
    expect(trialSummary(trialing, FREE, PAID, testPlans.catalog).map((item) => item.line)).toEqual([
      '5 members (Free allows 3)',
      'Insights (Paid only)',
    ])
  })

  it('leaves out what a staff grant keeps on Free', () => {
    const granted = afterTrial(5, {
      features: { advanced_example: true },
      limits: { members: { limit: 10, used: 5, approaching: false } },
    })
    expect(trialSummary(granted, FREE, PAID, testPlans.catalog)).toEqual([])
  })

  it('leaves out an unlimited Free limit and a limit the workspace does not report', () => {
    const free = { entitlements: { members: null, advanced_example: true } }
    expect(trialSummary(afterTrial(50), free, PAID, testPlans.catalog)).toEqual([])
    expect(
      trialSummary(afterTrial(5, { limits: {} }), FREE, PAID, testPlans.catalog).map(
        (item) => item.key
      )
    ).toEqual(['advanced_example'])
  })
})
