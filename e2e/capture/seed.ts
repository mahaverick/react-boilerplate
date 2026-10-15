/**
 * @file The react capture's data: an owner with one tenant, a second member
 * who accepted an invitation (so the owner has a notification and the members
 * list has two rows), and an invitation still pending (for /invitations/accept).
 */
import {
  apiLogin,
  apiRequest,
  createTenant,
  createVerifiedUser,
  freshEmail,
  freshSlug,
} from '../live/helpers'
import { mailedToken } from './mailpit'
import type { Seed } from './types'

/** Creates the run's accounts and tenant through the API. */
export async function seedCapture(): Promise<Seed> {
  const owner = freshEmail()
  await createVerifiedUser(owner)
  const token = await apiLogin(owner)
  const slug = freshSlug()
  await createTenant(token, { name: 'Capture Co', slug })

  const member = freshEmail()
  await createVerifiedUser(member)
  await invite(token, slug, member, 'editor')
  const accepted = await apiRequest(await apiLogin(member), 'POST', '/invitations/accept', {
    token: await mailedToken(member, '/invitations/accept'),
  })
  if (accepted.status !== 200) throw new Error(`accept failed: ${accepted.status}`)

  const pending = freshEmail()
  await invite(token, slug, pending, 'viewer')
  const invitationToken = await mailedToken(pending, '/invitations/accept')

  return { sessions: { owner }, params: { slug, invitationToken } }
}

/** Invites `email` to the tenant as `role`; the API answers 202. */
async function invite(token: string, slug: string, email: string, role: string): Promise<void> {
  const sent = await apiRequest(token, 'POST', `/tenants/${slug}/invitations`, { email, role })
  if (sent.status !== 202 && sent.status !== 201) {
    throw new Error(`invite failed: ${sent.status} ${JSON.stringify(sent.body)}`)
  }
}
