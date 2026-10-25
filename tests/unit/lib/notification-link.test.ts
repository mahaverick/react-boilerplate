import { describe, expect, it } from 'vite-plus/test'
import { notificationLink } from '@/lib/notification-link'
import type { Notification } from '@/queries/notification.queries'

/**
 * A notification of one type.
 * @param type - The notification type.
 * @param metadata - The notification's metadata.
 */
function notice(type: string, metadata: Notification['metadata']): Notification {
  return {
    id: 'n1',
    userId: 'u1',
    type,
    title: 'T',
    body: 'B',
    metadata,
    readAt: null,
    createdAt: '2026-10-25T10:00:00.000Z',
  }
}

describe('notificationLink', () => {
  it.each([
    'billing_trial_ending',
    'billing_payment_failed',
    'billing_payer_left',
    'billing_upgrade_requested',
    'billing_paid_cancelled',
  ])('links %s to the billing page', (type) => {
    expect(notificationLink(notice(type, { tenantId: 't1', slug: 'acme' }))).toEqual({
      to: '/settings/workspace/$slug/billing',
      params: { slug: 'acme' },
      label: 'Open Billing',
    })
  })

  it('links workspace_full to the members page', () => {
    expect(notificationLink(notice('workspace_full', { slug: 'acme' }))).toEqual({
      to: '/settings/workspace/$slug/members',
      params: { slug: 'acme' },
      label: 'Open Members',
    })
  })

  it.each([
    ['no metadata', null],
    ['no slug', { tenantId: 't1' }],
    ['a number', { slug: 5 }],
    ['an empty slug', { slug: '' }],
    ['an underscore-prefixed slug', { slug: '_platform' }],
  ])('gives no link for %s', (_name, metadata) => {
    expect(notificationLink(notice('billing_payment_failed', metadata))).toBeNull()
  })

  it('gives no link for a non-billing type', () => {
    expect(notificationLink(notice('tenant_invitation', { slug: 'acme' }))).toBeNull()
  })
})
