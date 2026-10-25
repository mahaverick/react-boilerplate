import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useNow } from '@/hooks/use-now'
import { formatBillingDate } from '@/lib/billing-format'
import { track } from '@/observability/telemetry'
import { useTenantBilling } from '@/queries/billing.queries'
import { tenantSettingsQueryOptions } from '@/queries/tenant-forms.queries'
import type { TenantDetail } from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'

const DAY_MS = 24 * 60 * 60 * 1000

/** A workspace older than this no longer gets the explainer. */
const NEW_TENANT_MS = DAY_MS

/**
 * The `localStorage` key that records one user saw the explainer for one
 * tenant in this browser.
 * @param userId - The signed-in user's id.
 * @param tenantId - The tenant's id.
 */
function seenKey(userId: string, tenantId: string): string {
  return `billing.trial-explainer.${userId}.${tenantId}`
}

/**
 * Whether the explainer may show: `true` when this browser has no record of
 * it. With no user to key it by, or storage that cannot be read, it counts
 * as seen, so it shows nothing rather than on every visit.
 * @param key - The record's key; `null` when there is no user id.
 */
function isUnseen(key: string | null): boolean {
  if (key === null) return false
  try {
    return window.localStorage.getItem(key) === null
  } catch {
    return false
  }
}

/**
 * Records that the explainer was seen. A write that fails is ignored: the
 * dialog still closes, and only a later visit could show it again.
 * @param key - The record's key; `null` when there is no user id.
 */
function markSeen(key: string | null): void {
  if (key === null) return
  try {
    window.localStorage.setItem(key, new Date().toISOString())
  } catch {
    // Storage is full or blocked; closing the dialog is what matters now.
  }
}

/**
 * The trial explainer on a new workspace's Overview: shown once per user and
 * tenant in this browser, to members, while the workspace is in its Paid trial and was
 * created in the last 24 hours. The trial length is the tenant's own (its
 * creation to its trial's end, in whole days), and the end date is in the
 * tenant's time zone. Showing it tracks `trial_explainer_viewed`; "Got it",
 * or any other close, records it in `localStorage` under the user's id. With
 * no signed-in user id it shows nothing, as on a storage failure. Mount it with
 * `key={tenant.id}`, so a different tenant reads its own record.
 */
export function TrialExplainerDialog({ slug, tenant }: { slug: string; tenant: TenantDetail }) {
  const { data: billing } = useTenantBilling(slug)
  const now = useNow()
  const userId = useAuthStore((state) => state.user?.id)
  const key = userId === undefined ? null : seenKey(userId, tenant.id)
  const [unseen] = useState(() => isUnseen(key))
  const [closed, setClosed] = useState(false)
  const trialEndsAt = billing?.state === 'trialing' ? billing.trialEndsAt : null
  const eligible =
    unseen &&
    !closed &&
    tenant.access === 'member' &&
    trialEndsAt !== null &&
    now - Date.parse(tenant.createdAt) <= NEW_TENANT_MS
  // The date is the tenant's day, as the server writes it; a failed read falls back to UTC.
  const settings = useQuery({
    ...tenantSettingsQueryOptions(slug),
    retry: false,
    enabled: eligible,
  })
  const isOpen = eligible && !settings.isPending
  const viewed = useRef(false)

  useEffect(() => {
    if (!isOpen || viewed.current) return
    viewed.current = true
    track('trial_explainer_viewed')
  }, [isOpen])

  if (!isOpen || trialEndsAt === null) return null
  const days = Math.round((Date.parse(trialEndsAt) - Date.parse(tenant.createdAt)) / DAY_MS)
  const endsOn = formatBillingDate(trialEndsAt, settings.data?.timezone ?? 'UTC')

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (next) return
        markSeen(key)
        setClosed(true)
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>You’re on a {days}-day Paid trial</DialogTitle>
          <DialogDescription>
            Everything in Paid is on until {endsOn}. Then you move to Free. Nothing is deleted, and
            no card is needed.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            onClick={() => {
              markSeen(key)
              setClosed(true)
            }}
          >
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
