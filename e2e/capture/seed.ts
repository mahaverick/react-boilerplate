/**
 * @file The react capture's data: an owner with one tenant, a second member
 * who joined by an invitation's confirmation link as an editor (so the owner
 * has a notification, the members list has two rows, and the role-denied
 * shots have a session), a newcomer with an account and no tenant (for
 * /welcome) who holds a pending invitation (for /invitations/accept), and the
 * spent sign-in and confirmation links (for the dead-link shots).
 *
 * Every account signs in by mailed link, and express allows ten link requests
 * per fifteen minutes per IP: a run that also signs each session into three
 * contexts needs `RATE_LIMIT_SCALE` on the API under test.
 */
import {
  apiRequest,
  createTenant,
  createUser,
  freshEmail,
  freshSlug,
  joinByConfirmation,
} from '../live/helpers'
import { mailedLink, mailedToken } from './mailpit'
import type { Seed } from './types'

/** The name the owner's tenant gets. */
const TENANT_NAME = 'Capture Co'

/** Creates the run's accounts and tenant through the API. */
export async function seedCapture(): Promise<Seed> {
  const owner = freshEmail()
  const ownerSince = Date.now()
  const { accessToken: token } = await createUser(owner)
  // The link createUser just spent: opened again, it is the dead link.
  const spentLink = await mailedLink(owner, '/auth/link', ownerSince)
  const slug = freshSlug()
  await createTenant(token, { name: TENANT_NAME, slug })

  const member = freshEmail()
  await createUser(member)
  await invite(token, slug, member, 'editor')
  const confirmSince = Date.now()
  await joinByConfirmation(member, await mailedToken(member, '/invitations/accept'))
  const spentConfirmation = await mailedLink(member, '/invitations/confirm', confirmSince)

  // An account, so the accept page answers "Check your inbox" and every shot leaves the invitation pending.
  const newcomer = freshEmail()
  await createUser(newcomer)
  await invite(token, slug, newcomer, 'viewer')
  const invitationToken = await mailedToken(newcomer, '/invitations/accept')

  return {
    sessions: { owner, member, newcomer },
    params: {
      slug,
      invitationToken,
      tenantName: TENANT_NAME,
      spentLinkQuery: spentLink.search.slice(1),
      spentConfirmationQuery: spentConfirmation.search.slice(1),
    },
  }
}

/** Invites `email` to the tenant as `role`; the API answers 202. */
async function invite(token: string, slug: string, email: string, role: string): Promise<void> {
  const sent = await apiRequest(token, 'POST', `/tenants/${slug}/invitations`, { email, role })
  if (sent.status !== 202 && sent.status !== 201) {
    throw new Error(`invite failed: ${sent.status} ${JSON.stringify(sent.body)}`)
  }
}
