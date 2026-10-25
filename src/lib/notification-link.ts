import type { Notification } from '@/queries/notification.queries'

/** The billing notices, which all open the workspace's Billing page. */
const BILLING_TYPES: ReadonlySet<string> = new Set([
  'billing_trial_ending',
  'billing_payment_failed',
  'billing_payer_left',
  'billing_upgrade_requested',
  'billing_paid_cancelled',
])

/** A router link target for a notification; `to` is a route the router knows, so a rename fails the type check. */
export interface NotificationLink {
  to: '/settings/workspace/$slug/billing' | '/settings/workspace/$slug/members'
  params: { slug: string }
  label: 'Open Billing' | 'Open Members'
}

/**
 * Where a notification leads: a router link target, or null for a notification
 * with no destination. Billing notices open Billing and `workspace_full` opens
 * Members, both for the workspace in `metadata.slug`. A missing, non-string,
 * empty or `_`-prefixed slug (a reserved platform one) gives no link. The label
 * is static; the slug is never shown.
 * @param notification - The notification to link from.
 */
export function notificationLink(notification: Notification): NotificationLink | null {
  const slug = notification.metadata?.slug
  if (typeof slug !== 'string' || slug === '' || slug.startsWith('_')) return null
  if (BILLING_TYPES.has(notification.type)) {
    return { to: '/settings/workspace/$slug/billing', params: { slug }, label: 'Open Billing' }
  }
  if (notification.type === 'workspace_full') {
    return { to: '/settings/workspace/$slug/members', params: { slug }, label: 'Open Members' }
  }
  return null
}
