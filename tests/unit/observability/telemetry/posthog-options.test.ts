import type { CapturedNetworkRequest, CaptureResult } from 'posthog-js'
import { describe, expect, it, vi } from 'vite-plus/test'
import {
  ANALYTICS_CROSS_SUBDOMAIN_COOKIE,
  ANALYTICS_PERSISTENCE_NAME,
  ANALYTICS_URL_QUERY_ALLOWLIST,
} from '@/observability/telemetry/config'
import { maskReplayAttribute } from '@/observability/telemetry/mask-attribute'
import {
  buildPosthogOptions,
  CUSTOM_PERSONAL_DATA_PROPERTIES,
  MASK_TEXT_SELECTOR,
  PII_CLASS_NAME,
  type PosthogOptionsInput,
} from '@/observability/telemetry/posthog-options'
import { invitationsList } from '@/queries/tenant.queries'

/** A complete options input for `buildPosthogOptions`, with any field overridden. */
function input(overrides: Partial<PosthogOptionsInput> = {}): PosthogOptionsInput {
  return {
    apiHost: 'https://app.example.com/api/v1/collect',
    uiHost: 'https://us.posthog.com',
    consentMode: 'opt_out',
    urlAllowlist: ['tab'],
    persistenceName: undefined,
    crossSubdomainCookie: true,
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
      advanced_disable_feature_flags: true,
      mask_all_element_attributes: true,
      mask_personal_data_properties: true,
      custom_personal_data_properties: [
        'token',
        'email',
        'redirect',
        'invitation',
        'q',
        'search',
        'invitationsSearch',
        'historySearch',
        'unregisteredSearch',
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
        captureCanvas: { recordCanvas: false },
      },
    })
    expect(options.session_recording?.captureCanvas?.recordCanvas).toBe(false)
    expect(options.custom_personal_data_properties).not.toBe(CUSTOM_PERSONAL_DATA_PROPERTIES)
    // `advanced_disable_flags` would also stop remote config, and session replay with it.
    expect(options).not.toHaveProperty('advanced_disable_flags')
  })

  it('takes the persistence name and cookie scope from its input, and from the config constants for this app', () => {
    expect(ANALYTICS_PERSISTENCE_NAME).toBeUndefined()
    expect(ANALYTICS_CROSS_SUBDOMAIN_COOKIE).toBe(true)
    const options = buildPosthogOptions(
      input({
        persistenceName: ANALYTICS_PERSISTENCE_NAME,
        crossSubdomainCookie: ANALYTICS_CROSS_SUBDOMAIN_COOKIE,
      })
    )
    expect(options).not.toHaveProperty('persistence_name')
    expect(options.cross_subdomain_cookie).toBe(true)
  })

  it('with no name and a shared cookie, builds the options the customer app has always had', () => {
    const options = buildPosthogOptions(
      input({ persistenceName: undefined, crossSubdomainCookie: true })
    )
    expect(options).not.toHaveProperty('persistence_name')
    expect(options.cross_subdomain_cookie).toBe(true)
    expect(options.persistence).toBe('localStorage+cookie')
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

  it('keeps the campaign keys of a mailed sign-in link and drops its token, email and redirect', () => {
    const beforeSend = buildPosthogOptions(input({ urlAllowlist: ANALYTICS_URL_QUERY_ALLOWLIST }))
      .before_send as (event: CaptureResult | null) => CaptureResult | null
    const campaign =
      'utm_source=email&utm_medium=email&utm_campaign=sign_in_link&utm_content=primary_button'
    const sent = beforeSend({
      uuid: 'u',
      event: '$pageview',
      properties: {
        $current_url: `https://app.example.com/auth/link?token=probe-token&email=a%40b.test&redirect=%2Fx&${campaign}`,
      },
    })
    expect(sent?.properties.$current_url).toBe(`https://app.example.com/auth/link?${campaign}`)
  })

  it('keeps the campaign keys of a mailed invitation and drops its token, email and a hand-edited value', () => {
    const beforeSend = buildPosthogOptions(input({ urlAllowlist: ANALYTICS_URL_QUERY_ALLOWLIST }))
      .before_send as (event: CaptureResult | null) => CaptureResult | null
    const campaign =
      'utm_source=email&utm_medium=email&utm_campaign=tenant_invitation&utm_content=primary_button'
    const sent = beforeSend({
      uuid: 'u',
      event: '$pageview',
      properties: {
        $current_url: `https://app.example.com/invitations/accept?token=probe-token&email=a%40b.test&${campaign}&utm_term=a%40b.test`,
      },
    })
    expect(sent?.properties.$current_url).toBe(
      `https://app.example.com/invitations/accept?${campaign}`
    )
  })

  it('keeps the campaign keys of a mailed invitation confirmation and drops its token and email', () => {
    const beforeSend = buildPosthogOptions(input({ urlAllowlist: ANALYTICS_URL_QUERY_ALLOWLIST }))
      .before_send as (event: CaptureResult | null) => CaptureResult | null
    const campaign =
      'utm_source=email&utm_medium=email&utm_campaign=invitation_confirm&utm_content=primary_button'
    const sent = beforeSend({
      uuid: 'u',
      event: '$pageview',
      properties: {
        $current_url: `https://app.example.com/invitations/confirm?token=probe-token&email=a%40b.test&${campaign}`,
        $referrer: `https://app.example.com/invitations/confirm?token=probe-token&email=a%40b.test&${campaign}`,
      },
    })
    expect(sent?.properties.$current_url).toBe(
      `https://app.example.com/invitations/confirm?${campaign}`
    )
    expect(sent?.properties.$referrer).toBe(
      `https://app.example.com/invitations/confirm?${campaign}`
    )
  })

  it('masks the token and email of a confirmation link in a replayed request name', () => {
    const mask = buildPosthogOptions(input()).session_recording?.maskCapturedNetworkRequestFn as (
      request: CapturedNetworkRequest
    ) => CapturedNetworkRequest
    const request = {
      name: 'https://app.example.com/invitations/confirm?token=probe-token&email=a%40b.test',
    }
    expect(mask(request as CapturedNetworkRequest).name).toBe(
      'https://app.example.com/invitations/confirm'
    )
  })

  it('drops a utm value that is not one of the shapes the API sends', () => {
    const beforeSend = buildPosthogOptions(input({ urlAllowlist: ANALYTICS_URL_QUERY_ALLOWLIST }))
      .before_send as (event: CaptureResult | null) => CaptureResult | null
    const sent = beforeSend({
      uuid: 'u',
      event: '$pageview',
      properties: {
        $current_url:
          'https://app.example.com/invitations/accept?token=probe-token&utm_source=email&utm_content=a%40b.test',
      },
    })
    expect(sent?.properties.$current_url).toBe(
      'https://app.example.com/invitations/accept?utm_source=email'
    )
  })

  it('turns off the automatic pageview and keeps the pageleave', () => {
    expect(buildPosthogOptions(input())).toMatchObject({
      capture_pageview: false,
      capture_pageleave: true,
    })
  })

  it('runs guardEvent first: null drops the event, and what it returns is what is sanitised', () => {
    const guardEvent = vi.fn((event: CaptureResult) =>
      event.event === 'drop-me'
        ? null
        : {
            ...event,
            properties: { ...event.properties, $current_url: 'https://app.example.com/y?token=t' },
          }
    )
    const beforeSend = buildPosthogOptions(input({ guardEvent })).before_send as (
      event: CaptureResult | null
    ) => CaptureResult | null
    const dropped = { uuid: 'u', event: 'drop-me', properties: {} }
    expect(beforeSend(dropped)).toBeNull()
    expect(guardEvent).toHaveBeenCalledWith(dropped)
    const sent = beforeSend({ uuid: 'u', event: '$pageview', properties: {} })
    expect(sent?.properties.$current_url).toBe('https://app.example.com/y')
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

  it('masks token and email in a captured request name', () => {
    const mask = buildPosthogOptions(input()).session_recording?.maskCapturedNetworkRequestFn as (
      request: CapturedNetworkRequest
    ) => CapturedNetworkRequest
    const request = {
      name: 'https://app.example.com/auth/link?token=probe-token&email=a%40b.test',
    }
    expect(mask(request as CapturedNetworkRequest).name).toBe('https://app.example.com/auth/link')
  })

  it('names the same classes <Pii> renders as the replay mask selector', () => {
    for (const className of PII_CLASS_NAME.split(' ')) {
      expect(MASK_TEXT_SELECTOR).toContain(`.${className}`)
    }
  })

  it('masks the search text of every list whose keys are prefixed', () => {
    for (const list of [invitationsList]) {
      expect(CUSTOM_PERSONAL_DATA_PROPERTIES).toContain(list.urlKey('search'))
    }
  })
})
