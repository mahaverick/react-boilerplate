/** One question and its answer. */
interface Faq {
  question: string
  answer: string
}

/** The questions every visitor sees. */
const FAQS: readonly Faq[] = [
  {
    question: 'What happens when my trial ends?',
    answer:
      'You move to Free. Nothing is deleted. Members and data stay; you can’t add more than Free allows.',
  },
  {
    question: 'Can I cancel any time?',
    answer:
      'Yes. Cancel from Billing in one step. You keep Paid until the end of the period you paid for.',
  },
  {
    question: 'How can I pay?',
    answer: 'Cards and UPI, through Razorpay. Yearly plans are charged once a year.',
  },
]

/** The tax question, asked only when the business is GST-registered. */
const GST_FAQ: Faq = {
  question: 'Do prices include tax?',
  answer: 'Yes. Prices include 18% GST.',
}

/**
 * The pricing page's questions, as a description list under an `h2`. The tax
 * question shows only when the business is GST-registered, since only then
 * do the prices include GST.
 */
export function PricingFaq({ gstRegistered }: { gstRegistered: boolean }) {
  const faqs = gstRegistered ? [...FAQS, GST_FAQ] : FAQS
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
