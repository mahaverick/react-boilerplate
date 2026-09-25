import { Link } from '@tanstack/react-router'
import { ShieldAlert } from 'lucide-react'
import { ROLE_LABELS, type MembershipRole } from '@/constants/roles'
import { ROUTES } from '@/constants/routes'

/**
 * Shown on every page of a tenant the viewer reached as platform staff, not
 * as a member. Not dismissible: it says whose data this is and on what
 * authority, and that stays true for as long as the page is open.
 *
 * `bg-muted` with `text-foreground`: the measured AA pair. Muted text on a
 * muted surface is the 4.35:1 failure `pnpm test:contrast` caught once.
 */
export function PlatformAccessBanner({
  tenantName,
  role,
}: {
  tenantName: string
  role: MembershipRole
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-muted px-4 py-3 text-sm text-foreground"
    >
      <ShieldAlert aria-hidden="true" className="size-4 shrink-0" />
      <p className="min-w-0 flex-1">
        You’re viewing <strong>{tenantName}</strong> as platform staff ({ROLE_LABELS[role]}).
      </p>
      <Link to={ROUTES.tenants} className="font-medium underline underline-offset-4">
        Back to your tenants
      </Link>
    </div>
  )
}
