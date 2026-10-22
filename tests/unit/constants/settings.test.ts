import { describe, expect, it } from 'vite-plus/test'
import {
  isSettingsPath,
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  settingsActiveSection,
} from '@/constants/settings'

describe('settingsActiveSection', () => {
  it('highlights nothing on the landing page', () => {
    expect(settingsActiveSection('/settings')).toBeNull()
    expect(settingsActiveSection('/settings/')).toBeNull()
  })

  it('matches an account section exactly and with a trailing slash', () => {
    expect(settingsActiveSection('/settings/account/profile')?.label).toBe('Profile')
    expect(settingsActiveSection('/settings/account/security/')?.label).toBe('Security')
  })

  it('matches a workspace section for any tenant slug', () => {
    expect(settingsActiveSection('/settings/workspace/acme/members')?.label).toBe('Members')
    expect(settingsActiveSection('/settings/workspace/beta-inc/activity')?.label).toBe('Activity')
  })

  it('does not match a prefix that is not a whole segment', () => {
    expect(settingsActiveSection('/settings/account/profiles')).toBeNull()
    expect(settingsActiveSection('/settings/workspace/acme')).toBeNull()
  })

  it('does not match pages outside settings', () => {
    expect(settingsActiveSection('/tenants/acme/members')).toBeNull()
  })
})

describe('isSettingsPath', () => {
  it('is true for /settings and below only', () => {
    expect(isSettingsPath('/settings')).toBe(true)
    expect(isSettingsPath('/settings/account/profile')).toBe(true)
    expect(isSettingsPath('/settingsx')).toBe(false)
    expect(isSettingsPath('/dashboard')).toBe(false)
  })
})

describe('settings config', () => {
  it('puts every section in a declared group, in group order', () => {
    const groups = SETTINGS_GROUPS.map((group) => group.id)
    expect(groups).toEqual(['account', 'workspace'])
    expect(SETTINGS_SECTIONS.map((section) => section.label)).toEqual([
      'Profile',
      'Security',
      'Notifications',
      'General',
      'Members',
      'Activity',
    ])
  })
})
