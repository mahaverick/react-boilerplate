import { nounFor } from '@/lib/plural'
import type { EntitlementValue, PlansResponse } from '@/types/billing.types'

/** One question and its answer. */
interface Faq {
  question: string
  answer: string
}

/**
 * What happens at the trial's end, with Free's member limit when the plans
 * give one.
 * @param freeMembers - Free's `members` entitlement: a count, or none.
 * @returns The question and its answer.
 */
function trialEndFaq(freeMembers: EntitlementValue | undefined): Faq {
  const limit =
    typeof freeMembers === 'number'
      ? ` Free allows ${String(freeMembers)} ${nounFor(freeMembers, 'members')}; you can’t add more than that.`
      : ''
  return {
    question: 'What happens when my trial ends?',
    answer: `You move to Free. Nothing is deleted. Members and data stay.${limit}`,
  }
}

/** The questions every visitor sees after the trial one. */
const FAQS: readonly Faq[] = [
  {
    question: 'Can I cancel any time?',
    answer:
      'Yes. Cancel from Billing in one step. You keep Paid until the end of the period you paid for.',
  },
  {
    question: 'How can I pay?',
    answer:
      'Cards and Unified Payments Interface (UPI), through Razorpay. Yearly plans are charged once a year.',
  },
]

/** The tax question, asked only when the business is GST-registered. */
const GST_FAQ: Faq = {
  question: 'Do prices include tax?',
  answer: 'Yes. Prices include 18% Goods and Services Tax (GST).',
}

/**
 * The pricing page's questions, as a description list under an `h2`. The tax
 * question shows only when the business is GST-registered, since only then
 * do the prices include GST.
 */
export function PricingFaq({ plans }: { plans: PlansResponse }) {
  const free = plans.plans.find((plan) => plan.key === 'free')
  const faqs = [
    trialEndFaq(free?.entitlements.members),
    ...FAQS,
    ...(plans.gstRegistered ? [GST_FAQ] : []),
  ]
  return (
    <section aria-labelledby="pricing-faq" className="grid gap-4">
      <h2 id="pricing-faq" className="font-heading text-lg font-semibold">
        Questions
      </h2>
      <dl className="grid gap-4 text-sm">
        {faqs.map((faq) => (
          <div key={faq.question} className="grid gap-1">
            <dt className="font-medium">{faq.question}</dt>
            <dd className="text-muted-foreground">{faq.answer}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
