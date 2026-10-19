import { toast } from '@/lib/toast'

/** The workspace an invitation joined, as the API names it. */
export interface JoinedTenant {
  name: string
  slug: string
}

/**
 * Toasts the join, naming the account now signed in, then opens the app's
 * landing for the tenant through `open`. Pass the server's address, never one
 * from the URL. The toast root is masked for analytics, so the address is too.
 * Each app passes its own landing, so this stays app-neutral.
 * @param tenant - The tenant joined.
 * @param account - The signed-in address, from the server's answer or session.
 * @param alreadyMember - True when the caller had joined already.
 * @param open - Navigates to the app's landing for `tenant`, replacing the token page.
 */
export function landJoined(
  tenant: JoinedTenant,
  account: string,
  alreadyMember: boolean,
  open: (tenant: JoinedTenant) => void
): void {
  toast.success(
    alreadyMember
      ? `You’ve already joined ${tenant.name} as ${account}.`
      : `You joined ${tenant.name} as ${account}.`
  )
  open(tenant)
}
