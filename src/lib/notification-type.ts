/** Labels the generic humanizer would word badly, keyed by notification type. */
const TYPE_LABELS: Readonly<Record<string, string>> = {
  billing_trial_ending: 'Trial ending',
  billing_payment_failed: 'Payment failed',
  billing_payer_left: 'Card owner left',
  billing_upgrade_requested: 'Upgrade request',
  billing_paid_cancelled: 'Paid cancelled',
  workspace_full: 'Workspace full',
}

/**
 * A notification type as a label a reader can parse: the billing and workspace
 * types have set labels, and any other falls back to the type with spaces
 * (`tenant_invitation` -> `Tenant invitation`).
 * @param type - The notification type.
 */
export function humanizeNotificationType(type: string): string {
  const label = TYPE_LABELS[type]
  if (label !== undefined) return label
  const spaced = type.replaceAll('_', ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
