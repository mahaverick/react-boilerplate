import { describe, expect, it } from 'vitest'
import { maskReplayAttribute } from '@/observability/analytics/mask-attribute'

describe('maskReplayAttribute', () => {
  it.each([
    ['aria-label', 'Remove Pii Probe'],
    ['ARIA-LABEL', 'Account menu for Pii Probe'],
    ['title', 'Pii Probe'],
    ['alt', 'Pii Probe'],
    ['placeholder', 'pii-probe@example.test'],
    ['data-email', 'pii-probe@example.test'],
    ['data-state', 'open'],
    ['href', 'mailto:pii-probe@example.test'],
    ['href', '/invitations/accept?token=probe-token'],
    ['href', 'tel:+15555550123'],
    ['href', ' TEL:+15555550123'],
    ['src', '/avatars/1.png?token=probe-token'],
    ['srcset', '/a.png?token=probe-token 1x, /b.png 2x'],
    ['srcdoc', '<p>Pii Probe</p>'],
    ['SRCDOC', '<p>Pii Probe</p>'],
  ])('masks %s="%s"', (name, value) => {
    expect(maskReplayAttribute(name, value)).toBe('***')
  })

  it.each([
    ['href', '/tenants/acme/members'],
    ['src', '/assets/logo.svg'],
    ['class', 'ph-sensitive ph-mask'],
    ['id', 'main'],
    ['role', 'menu'],
    ['type', 'button'],
  ])('keeps %s="%s"', (name, value) => {
    expect(maskReplayAttribute(name, value)).toBe(value)
  })
})
