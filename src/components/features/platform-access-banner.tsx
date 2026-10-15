import { Link } from '@tanstack/react-router'
import { Note } from '@/components/shared/note'
import { ROLE_LABELS, type MembershipRole } from '@/constants/roles'
import { ROUTES } from '@/constants/routes'

/**
 * Shown on every page of a tenant the viewer reached as platform staff, not
 * as a member. Not dismissible: it says whose data this is and on what
 * authority, and that stays true for as long as the page is open.
 */
export function PlatformAccessBanner({
  tenantName,
  role,
}: {
  tenantName: string
  role: MembershipRole
}) {
  return (
    <Note tone="info">
      You’re viewing <strong>{tenantName}</strong> as platform staff ({ROLE_LABELS[role]}).{' '}
      <Link to={ROUTES.tenants} className="font-medium underline underline-offset-4">
        Back to your tenants
      </Link>
    </Note>
  )
}
