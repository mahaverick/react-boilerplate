import { describe, expect, it } from 'vitest'
import {
  actorName,
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  auditSentence,
  isAuditAction,
} from '@/constants/audit-actions'
import { INVITATION_ID, USER_ID, USER_ID_2 } from '@/tests/fixtures/ids'

describe('AUDIT_ACTIONS', () => {
  it('lists exactly the eighteen actions the API writes', () => {
    expect([...AUDIT_ACTIONS].sort()).toEqual(
      [
        'invitation.accepted',
        'invitation.created',
        'invitation.resent',
        'invitation.revoked',
        'member.removed',
        'member.role_changed',
        'onboarding.dismissed',
        'onboarding.reminder_sent',
        'onboarding.step_completed',
        'onboarding.undismissed',
        'platform.member.auto_joined',
        'platform.member.granted',
        'tenant.accessed_by_platform',
        'tenant.created',
        'tenant.settings_updated',
        'tenant.updated',
        'tenant.errors_viewed',
        'user.errors_viewed',
      ].sort()
    )
    for (const action of AUDIT_ACTIONS) expect(AUDIT_ACTION_LABELS[action]).not.toBe('')
  })

  it('recognises its own actions and nothing else', () => {
    expect(isAuditAction('member.removed')).toBe(true)
    expect(isAuditAction('member.deleted')).toBe(false)
  })
})

describe('auditSentence', () => {
  it.each([
    ['tenant.created', { name: 'Acme Corp', slug: 'acme' }, 'created the tenant “Acme Corp”'],
    ['tenant.updated', { changed: ['name', 'website'] }, 'updated the tenant (name, website)'],
    ['tenant.settings_updated', { changed: ['timezone'] }, 'changed the settings (timezone)'],
    [
      'member.role_changed',
      { userId: USER_ID_2, from: 'viewer', to: 'editor' },
      'changed a member’s role from Viewer to Editor',
    ],
    [
      'member.removed',
      { userId: USER_ID_2, role: 'editor', self: false },
      'removed a member (Editor)',
    ],
    ['member.removed', { userId: USER_ID_2, role: 'editor', self: true }, 'left the tenant'],
    [
      'invitation.created',
      { role: 'viewer', emailDomain: 'example.com' },
      'invited someone at example.com as Viewer',
    ],
    [
      'invitation.resent',
      { role: 'viewer', emailDomain: 'example.com' },
      'resent the invitation to someone at example.com',
    ],
    [
      'invitation.revoked',
      { role: 'viewer', emailDomain: 'example.com' },
      'revoked the invitation to someone at example.com',
    ],
    [
      'invitation.accepted',
      { role: 'admin', invitationId: INVITATION_ID },
      'accepted an invitation as Admin',
    ],
    [
      'platform.member.auto_joined',
      { userId: USER_ID_2, emailDomain: 'corp.test' },
      'added someone at corp.test to the platform as Viewer (auto-join)',
    ],
    [
      'platform.member.granted',
      { userId: USER_ID_2, role: 'admin', via: 'script' },
      'granted a platform member the Admin role',
    ],
    [
      'tenant.accessed_by_platform',
      { platformRole: 'viewer' },
      'opened this tenant as platform staff (Viewer)',
    ],
    ['onboarding.dismissed', {}, 'hid the getting started checklist'],
    ['onboarding.undismissed', {}, 'showed the getting started checklist again'],
    [
      'onboarding.step_completed',
      { reason: 'Customer asked on a call', stepKey: 'configure_settings' },
      'marked the “configure settings” step complete',
    ],
    [
      'onboarding.reminder_sent',
      {
        reason: 'Stuck for a week',
        recipientCount: 2,
        emailDomains: ['acme.test'],
        messageIds: [],
      },
      'sent an onboarding reminder to 2 owners',
    ],
    [
      'onboarding.reminder_sent',
      { reason: 'Stuck', recipientCount: 1, emailDomains: ['acme.test'], messageIds: [] },
      'sent an onboarding reminder to 1 owner',
    ],
    ['user.errors_viewed', {}, 'viewed a user’s errors'],
    ['tenant.errors_viewed', {}, 'viewed a tenant’s errors'],
  ])('%s reads as a sentence', (action, metadata, sentence) => {
    expect(auditSentence({ action, metadata })).toBe(sentence)
  })

  it('degrades rather than throwing on missing or mistyped metadata', () => {
    expect(auditSentence({ action: 'member.role_changed', metadata: {} })).toBe(
      'changed a member’s role from an unknown role to an unknown role'
    )
    expect(auditSentence({ action: 'tenant.updated', metadata: { changed: 'name' } })).toBe(
      'updated the tenant'
    )
    expect(auditSentence({ action: 'tenant.archived', metadata: {} })).toBe(
      'performed tenant.archived'
    )
    expect(
      auditSentence({
        action: 'invitation.created',
        metadata: { role: 'viewer', emailDomain: null },
      })
    ).toBe('invited someone at an unknown domain as Viewer')
    expect(auditSentence({ action: 'onboarding.step_completed', metadata: {} })).toBe(
      'marked an onboarding step complete'
    )
    expect(
      auditSentence({ action: 'onboarding.reminder_sent', metadata: { recipientCount: '2' } })
    ).toBe('sent an onboarding reminder to the owners')
  })
})

describe('actorName', () => {
  it('prefers the name, falls back to the email, and calls a null actor the system', () => {
    expect(actorName({ id: USER_ID, name: 'Ada Lovelace', email: 'ada@b.com' })).toBe(
      'Ada Lovelace'
    )
    expect(actorName({ id: USER_ID, name: '', email: 'ada@b.com' })).toBe('ada@b.com')
    expect(actorName(null)).toBe('System')
  })
})
