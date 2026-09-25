import { describe, expect, it } from 'vitest'
import {
  canActorGrantRole,
  canActorModifyTarget,
  canChangeRoles,
  canManageTenant,
  canViewActivity,
  canViewPlatformActivity,
  isLastOwnerBlocked,
  isStaff,
  MEMBERSHIP_ROLES,
} from '@/constants/roles'

describe('canActorModifyTarget', () => {
  it('lets an owner act on any non-owner target', () => {
    for (const target of ['admin', 'manager', 'editor', 'viewer'] as const) {
      expect(canActorModifyTarget('owner', target, false)).toBe(true)
    }
  })

  it('lets an owner act on an owner only when it is themselves', () => {
    expect(canActorModifyTarget('owner', 'owner', true)).toBe(true)
    expect(canActorModifyTarget('owner', 'owner', false)).toBe(false)
  })

  it('blocks an admin from acting on an owner or another admin', () => {
    expect(canActorModifyTarget('admin', 'owner', false)).toBe(false)
    expect(canActorModifyTarget('admin', 'admin', false)).toBe(false)
  })

  it('blocks an admin from acting on their OWN admin membership', () => {
    // `isSelf` does not rescue an admin target: the backend's matrix answers
    // "no" for an admin target whatever `isSelf` says, so an admin cannot
    // even remove themselves. Pinned because it is the one cell where the
    // self exception people expect does not exist.
    expect(canActorModifyTarget('admin', 'admin', true)).toBe(false)
  })

  it('lets an admin act on manager, editor and viewer', () => {
    for (const target of ['manager', 'editor', 'viewer'] as const) {
      expect(canActorModifyTarget('admin', target, false)).toBe(true)
    }
  })

  it('denies every other actor role', () => {
    for (const actor of ['manager', 'editor', 'viewer'] as const) {
      expect(canActorModifyTarget(actor, 'viewer', false)).toBe(false)
    }
  })

  it('denies every other actor role against every target, self or not', () => {
    // The whole fail-closed row, not just its first cell: manager, editor and
    // viewer never reach these endpoints at all.
    for (const actor of ['manager', 'editor', 'viewer'] as const) {
      for (const target of MEMBERSHIP_ROLES) {
        expect(canActorModifyTarget(actor, target, false)).toBe(false)
        expect(canActorModifyTarget(actor, target, true)).toBe(false)
      }
    }
  })
})

describe('canActorGrantRole', () => {
  it('lets an owner grant anything', () => {
    for (const role of ['owner', 'admin', 'manager', 'editor', 'viewer'] as const) {
      expect(canActorGrantRole('owner', role)).toBe(true)
    }
  })

  it('stops an admin granting owner or admin', () => {
    expect(canActorGrantRole('admin', 'owner')).toBe(false)
    expect(canActorGrantRole('admin', 'admin')).toBe(false)
    expect(canActorGrantRole('admin', 'manager')).toBe(true)
  })

  it('lets an admin grant every role below admin', () => {
    for (const role of ['manager', 'editor', 'viewer'] as const) {
      expect(canActorGrantRole('admin', role)).toBe(true)
    }
  })

  it('denies every other actor role, including granting viewer', () => {
    for (const actor of ['manager', 'editor', 'viewer'] as const) {
      for (const role of MEMBERSHIP_ROLES) {
        expect(canActorGrantRole(actor, role)).toBe(false)
      }
    }
  })
})

describe('canChangeRoles', () => {
  it('is owner-only — an admin cannot change even a viewer', () => {
    expect(canChangeRoles('owner')).toBe(true)
    expect(canChangeRoles('admin')).toBe(false)
  })

  it('denies manager, editor and viewer', () => {
    for (const actor of ['manager', 'editor', 'viewer'] as const) {
      expect(canChangeRoles(actor)).toBe(false)
    }
  })
})

describe('canManageTenant', () => {
  it('is owner and admin', () => {
    expect(canManageTenant('owner')).toBe(true)
    expect(canManageTenant('admin')).toBe(true)
  })

  it('denies manager, editor and viewer', () => {
    for (const actor of ['manager', 'editor', 'viewer'] as const) {
      expect(canManageTenant(actor)).toBe(false)
    }
  })
})

describe('isLastOwnerBlocked', () => {
  it('blocks an owner acting on their own membership when they are the only owner', () => {
    expect(isLastOwnerBlocked({ targetRole: 'owner', isSelf: true, ownerCount: 1 })).toBe(true)
  })

  it('allows it once a second owner exists', () => {
    expect(isLastOwnerBlocked({ targetRole: 'owner', isSelf: true, ownerCount: 2 })).toBe(false)
  })

  it('does not block acting on somebody else, or on a non-owner membership', () => {
    expect(isLastOwnerBlocked({ targetRole: 'owner', isSelf: false, ownerCount: 1 })).toBe(false)
    expect(isLastOwnerBlocked({ targetRole: 'admin', isSelf: true, ownerCount: 1 })).toBe(false)
  })
})

describe('canViewActivity', () => {
  // The audit-log route is `requireRole('owner', 'admin')` on the EFFECTIVE
  // role, so a staff admin passes and a staff viewer does not.
  it('allows owners and admins only', () => {
    expect(MEMBERSHIP_ROLES.filter((role) => canViewActivity(role))).toEqual(['owner', 'admin'])
  })
})

describe('isStaff', () => {
  it('is true for any platform role', () => {
    for (const role of MEMBERSHIP_ROLES) expect(isStaff(role)).toBe(true)
  })

  // `undefined` is a user object from a response that predates the field:
  // not staff, rather than a crash or a guess.
  it('is false for null and for a missing field', () => {
    expect(isStaff(null)).toBe(false)
    expect(isStaff(undefined)).toBe(false)
  })
})

describe('canViewPlatformActivity', () => {
  it('allows platform owners and admins only', () => {
    expect(MEMBERSHIP_ROLES.filter((role) => canViewPlatformActivity(role))).toEqual([
      'owner',
      'admin',
    ])
    expect(canViewPlatformActivity(null)).toBe(false)
    expect(canViewPlatformActivity(undefined)).toBe(false)
  })
})
