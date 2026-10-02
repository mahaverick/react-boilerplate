import type { CapturedNetworkRequest, CaptureResult } from 'posthog-js'
import { describe, expect, it, vi } from 'vitest'
import { maskReplayAttribute } from '@/observability/analytics/mask-attribute'
import {
  buildPosthogOptions,
  CUSTOM_PERSONAL_DATA_PROPERTIES,
  MASK_TEXT_SELECTOR,
  PII_CLASS_NAME,
  type PosthogOptionsInput,
} from '@/observability/analytics/posthog-options'

function input(overrides: Partial<PosthogOptionsInput> = {}): PosthogOptionsInput {
  return {
    apiHost: 'https://app.example.com/api/v1/collect',
    uiHost: 'https://us.posthog.com',
    consentMode: 'opt_out',
    urlAllowlist: ['tab'],
    onLoaded: vi.fn(),
    ...overrides,
  }
}

describe('buildPosthogOptions', () => {
  it('pins the privacy settings', () => {
    const options = buildPosthogOptions(input())
    expect(options).toMatchObject({
      api_host: 'https://app.example.com/api/v1/collect',
      ui_host: 'https://us.posthog.com',
      defaults: '2026-08-30',
      autocapture: true,
      mask_all_element_attributes: true,
      mask_personal_data_properties: true,
      custom_personal_data_properties: [
        'token',
        'email',
        'redirect',
        'invitation',
        'q',
        'search',
        'ph_did',
        'ph_sid',
      ],
      persistence: 'localStorage+cookie',
      cross_subdomain_cookie: true,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: '.ph-mask, .ph-sensitive',
        maskAttributeFn: maskReplayAttribute,
        captureJsonLd: false,
        recordHeaders: false,
        recordBody: false,
      },
    })
    expect(options.custom_personal_data_properties).not.toBe(CUSTOM_PERSONAL_DATA_PROPERTIES)
  })

  it('opt_out: no cookieless mode and no bootstrap', () => {
    const options = buildPosthogOptions(input())
    expect(options).not.toHaveProperty('cookieless_mode')
    expect(options).not.toHaveProperty('bootstrap')
  })

  it('required: cookieless on reject', () => {
    expect(buildPosthogOptions(input({ consentMode: 'required' })).cookieless_mode).toBe(
      'on_reject'
    )
  })

  it('passes an accepted handoff through as bootstrap', () => {
    const bootstrap = { distinctID: '01a0fc35-b7ee-7b93-b550-d8a7f98e30be' }
    expect(buildPosthogOptions(input({ bootstrap })).bootstrap).toEqual(bootstrap)
  })

  it('hands the loaded instance to onLoaded', () => {
    const onLoaded = vi.fn()
    expect(buildPosthogOptions(input({ onLoaded })).loaded).toBe(onLoaded)
  })

  it('sanitises URLs in before_send and passes a dropped event through as dropped', () => {
    const beforeSend = buildPosthogOptions(input()).before_send as (
      event: CaptureResult | null
    ) => CaptureResult | null
    expect(beforeSend(null)).toBeNull()
    const sent = beforeSend({
      uuid: 'u',
      event: '$pageview',
      properties: { $current_url: 'https://app.example.com/x?token=probe-token&tab=a' },
    })
    expect(sent?.properties.$current_url).toBe('https://app.example.com/x?tab=a')
  })

  it('sanitises the URL replay records for the page and each network request', () => {
    const mask = buildPosthogOptions(input()).session_recording?.maskCapturedNetworkRequestFn as (
      request: CapturedNetworkRequest
    ) => CapturedNetworkRequest
    const page = { name: 'https://app.example.com/invitations/accept?token=probe-token' }
    expect(mask(page as CapturedNetworkRequest).name).toBe(
      'https://app.example.com/invitations/accept'
    )
  })

  it('names the same classes <Pii> renders as the replay mask selector', () => {
    for (const className of PII_CLASS_NAME.split(' ')) {
      expect(MASK_TEXT_SELECTOR).toContain(`.${className}`)
    }
  })
})
