import { describe, expect, it } from 'vitest'
import {
  actorName,
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  auditSentence,
  isAuditAction,
} from '@/constants/audit-actions'

describe('AUDIT_ACTIONS', () => {
  it('lists exactly the twelve actions the API writes', () => {
    expect([...AUDIT_ACTIONS].sort()).toEqual(
      [
        'invitation.accepted',
        'invitation.created',
        'invitation.resent',
        'invitation.revoked',
        'member.removed',
        'member.role_changed',
        'platform.member.auto_joined',
        'platform.member.granted',
        'tenant.accessed_by_platform',
        'tenant.created',
        'tenant.settings_updated',
        'tenant.updated',
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
      { userId: 'u2', from: 'viewer', to: 'editor' },
      'changed a member’s role from Viewer to Editor',
    ],
    ['member.removed', { userId: 'u2', role: 'editor', self: false }, 'removed a member (Editor)'],
    ['member.removed', { userId: 'u2', role: 'editor', self: true }, 'left the tenant'],
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
      { role: 'admin', invitationId: 'inv-1' },
      'accepted an invitation as Admin',
    ],
    [
      'platform.member.auto_joined',
      { userId: 'u2', emailDomain: 'corp.test' },
      'auto-joined the platform as Viewer (corp.test)',
    ],
    [
      'platform.member.granted',
      { userId: 'u2', role: 'admin', via: 'script' },
      'granted a platform member the Admin role',
    ],
    [
      'tenant.accessed_by_platform',
      { platformRole: 'viewer' },
      'opened this tenant as platform staff (Viewer)',
    ],
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
  })
})

describe('actorName', () => {
  it('prefers the name, falls back to the email, and calls a null actor the system', () => {
    expect(actorName({ id: 'u1', name: 'Ada Lovelace', email: 'ada@b.com' })).toBe('Ada Lovelace')
    expect(actorName({ id: 'u1', name: '', email: 'ada@b.com' })).toBe('ada@b.com')
    expect(actorName(null)).toBe('System')
  })
})
