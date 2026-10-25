import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import { PlanChoice } from '@/components/features/billing/plan-choice'
import { formatBillingDate } from '@/lib/billing-format'
import { testBilling, testPlans } from '@/tests/fixtures/billing'
import type { PlansResponse } from '@/types/billing.types'

const TRIAL_END = '2099-11-05T18:30:00.000Z'

/** The plans with Paid's prices replaced. */
function plansWith(prices: PlansResponse['plans'][number]['prices']): PlansResponse {
  return {
    ...testPlans,
    plans: testPlans.plans.map((plan) => (plan.key === 'paid' ? { ...plan, prices } : plan)),
  }
}

/** Renders the choice for a trial ending at `TRIAL_END`. */
function renderChoice(props: Partial<Parameters<typeof PlanChoice>[0]> = {}) {
  const onUpgrade = vi.fn()
  render(
    <PlanChoice
      billing={testBilling({ trialEndsAt: TRIAL_END })}
      plans={testPlans}
      date={(iso) => formatBillingDate(iso, 'UTC')}
      now={new Date()}
      onUpgrade={onUpgrade}
      busy={false}
      disabled={false}
      {...props}
    />
  )
  return onUpgrade
}

describe('PlanChoice', () => {
  it('starts on monthly and upgrades with the interval chosen', async () => {
    const user = userEvent.setup()
    const onUpgrade = renderChoice()
    expect(screen.getByRole('button', { name: 'Monthly' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Upgrade to Paid' }))
    await user.click(screen.getByRole('button', { name: 'Yearly' }))
    await user.click(screen.getByRole('button', { name: 'Upgrade to Paid' }))
    expect(onUpgrade.mock.calls).toEqual([['month'], ['year']])
  })

  it('words the trial note with the chosen interval’s amount', async () => {
    const user = userEvent.setup()
    renderChoice()
    await user.click(screen.getByRole('button', { name: 'Yearly' }))
    expect(
      screen.getByText(
        'We’ll hold ₹5 on your card now and refund it. Your first charge of ₹9,990 is on 5 November 2099.'
      )
    ).toBeInTheDocument()
  })

  it('shows the GST line when the business is registered', () => {
    renderChoice({ plans: { ...testPlans, gstRegistered: true } })
    expect(screen.getByText('Includes 18% GST')).toBeInTheDocument()
  })

  it('offers no toggle when only one interval has a price', () => {
    renderChoice({
      plans: plansWith([
        { id: 'price_year', interval: 'year', amountMinor: 999_000, currency: 'INR' },
      ]),
    })
    expect(screen.queryByRole('group', { name: 'Billing interval' })).toBeNull()
    expect(screen.getByText('₹9,990 per year · ₹833 a month')).toBeInTheDocument()
  })

  it('renders nothing when Paid has no price', () => {
    const { container } = render(
      <PlanChoice
        billing={testBilling()}
        plans={plansWith([])}
        date={(iso) => iso}
        now={new Date()}
        onUpgrade={vi.fn()}
        busy={false}
        disabled={false}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps Paid after the period while cancelling, with no trial note', () => {
    renderChoice({
      billing: testBilling({
        state: 'active',
        interval: 'year',
        trialEndsAt: null,
        currentPeriodEnd: '2099-11-02T18:30:00.000Z',
        cancelAtPeriodEnd: true,
      }),
    })
    expect(
      screen.getByRole('button', { name: 'Keep Paid after 2 November 2099' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Yearly' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText(/We’ll hold ₹5/)).toBeNull()
  })

  it('offers a plain upgrade once a cancelled period has ended', () => {
    renderChoice({
      billing: testBilling({
        state: 'active',
        interval: 'month',
        trialEndsAt: null,
        currentPeriodEnd: '2026-10-21T18:30:00.000Z',
        cancelAtPeriodEnd: true,
      }),
      now: new Date('2026-10-23T10:00:00.000Z'),
    })
    expect(screen.getByRole('button', { name: 'Upgrade to Paid' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Keep Paid after/ })).toBeNull()
  })
})
