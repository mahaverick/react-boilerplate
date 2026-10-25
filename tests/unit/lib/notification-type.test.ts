import { describe, expect, it } from 'vite-plus/test'
import { humanizeNotificationType } from '@/lib/notification-type'

describe('humanizeNotificationType', () => {
  it.each([
    ['billing_trial_ending', 'Trial ending'],
    ['billing_payment_failed', 'Payment failed'],
    ['billing_payer_left', 'Card owner left'],
    ['billing_upgrade_requested', 'Upgrade request'],
    ['billing_paid_cancelled', 'Paid cancelled'],
    ['workspace_full', 'Workspace full'],
  ])('labels %s as %s', (type, label) => {
    expect(humanizeNotificationType(type)).toBe(label)
  })

  it('falls back to the humanized type for any other type', () => {
    expect(humanizeNotificationType('tenant_invitation')).toBe('Tenant invitation')
    expect(humanizeNotificationType('something_new')).toBe('Something new')
  })
})
