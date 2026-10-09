import { http, HttpResponse } from 'msw'
import { PostHog, type CaptureResult } from 'posthog-js'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_SANITIZE_DEPTH,
  sanitizeEventUrls,
  sanitizeUrl,
} from '@/observability/analytics/url-sanitizer'
import { server } from '@/tests/mocks/server'

const ALLOW = ['tab']
const PROBES = ['pii-probe', 'probe-token', 'probe-ref', 'frag-probe', 'probe-redirect']

describe('sanitizeUrl', () => {
  it.each([
    [
      'https://app.example.com/register?email=pii-probe%40example.test&tab=members#frag-probe',
      'https://app.example.com/register?tab=members',
    ],
    [
      'https://app.example.com/invitations/accept?token=probe-token',
      'https://app.example.com/invitations/accept',
    ],
    [
      'https://app.example.com/login?redirect=%2Freset-password%3Ftoken%3Dprobe-token',
      'https://app.example.com/login',
    ],
    ['https://user:secret@app.example.com/x?tab=a&tab=b', 'https://app.example.com/x?tab=a&tab=b'],
    ['/x?token=probe-token&tab=a', '/x?tab=a'],
    ['/x#frag-probe', '/x'],
    ['mailto:pii-probe@example.test', 'mailto:'],
    ['https://app.example.com/plain', 'https://app.example.com/plain'],
  ])('%s → %s', (input, expected) => {
    expect(sanitizeUrl(input, ALLOW)).toBe(expected)
  })

  it('cuts an unparseable URL at its query', () => {
    expect(sanitizeUrl('http://[bad?token=probe-token', ALLOW)).toBe('http://[bad')
  })
})

describe('sanitizeEventUrls', () => {
  it('sanitises every URL-shaped property, the person-property copies and the element hrefs', () => {
    const event: CaptureResult = {
      uuid: 'u',
      event: '$autocapture',
      properties: {
        $current_url: 'https://app.example.com/register?email=pii-probe%40example.test&tab=x',
        $referrer: 'https://site.test/p?ref=probe-ref',
        $session_entry_url: 'https://app.example.com/a?token=probe-token',
        $external_click_url: 'https://elsewhere.test/?q=probe-ref',
        $pathname: '/register',
        $elements: [{ tag_name: 'a', attr__href: '/x?token=probe-token' }],
        $elements_chain:
          'a:attr__href="/x?token=probe-token"href="/x?token=probe-token"nth-child="1"',
        $heatmap_data: { 'https://app.example.com/a?token=probe-token': [{ x: 1 }] },
        $set: { $current_url: 'https://app.example.com/a?token=probe-token' },
        $set_once: { $initial_referrer: 'https://site.test/p?ref=probe-ref' },
        count: 3,
      },
      $set: { $initial_current_url: 'https://app.example.com/a?email=pii-probe' },
      $set_once: { $initial_referrer: 'https://site.test/p?ref=probe-ref' },
    }

    const sanitized = sanitizeEventUrls(event, ALLOW)

    const text = JSON.stringify(sanitized)
    for (const probe of PROBES) expect(text).not.toContain(probe)
    expect(sanitized.properties.$current_url).toBe('https://app.example.com/register?tab=x')
    expect(sanitized.properties.$pathname).toBe('/register')
    expect(sanitized.properties.count).toBe(3)
    expect(sanitized.properties.$elements_chain).toBe('a:attr__href="/x"href="/x"nth-child="1"')
    expect(Object.keys(sanitized.properties.$heatmap_data as object)).toEqual([
      'https://app.example.com/a',
    ])
    expect(JSON.stringify(event)).toContain('probe-token')
  })

  it('adds no $set or $set_once the event did not have', () => {
    const sanitized = sanitizeEventUrls({ uuid: 'u', event: 'x', properties: {} }, ALLOW)
    expect(sanitized).not.toHaveProperty('$set')
    expect(sanitized).not.toHaveProperty('$set_once')
  })
})

describe('sanitizeEventUrls on nested properties', () => {
  const DIRTY = 'https://app.example.com/a?token=probe-token&tab=x'
  const CLEAN = 'https://app.example.com/a?tab=x'

  it('sanitises a web-vitals-shaped event, however deep the URL sits', () => {
    const event: CaptureResult = {
      uuid: 'u',
      event: '$web_vitals',
      properties: {
        $web_vitals_LCP_event: {
          name: 'LCP',
          value: 1200,
          navigationURL: DIRTY,
          $current_url: DIRTY,
          attribution: { url: DIRTY, element: '#hero' },
        },
        $set: { nested: { page: DIRTY } },
      },
      $set_once: { first: { page: DIRTY } },
    }
    const sanitized = sanitizeEventUrls(event, ALLOW)
    const text = JSON.stringify(sanitized)
    expect(text).not.toContain('probe-token')
    const vitals = sanitized.properties.$web_vitals_LCP_event as Record<string, unknown>
    expect(vitals.navigationURL).toBe(CLEAN)
    expect(vitals.$current_url).toBe(CLEAN)
    expect(vitals.value).toBe(1200)
    expect((vitals.attribution as Record<string, unknown>).url).toBe(CLEAN)
    expect(JSON.stringify(event)).toContain('probe-token')
  })

  it('sanitises URLs inside arrays', () => {
    const sanitized = sanitizeEventUrls(
      {
        uuid: 'u',
        event: '$exception',
        properties: { $exception_list: [{ stacktrace: { frames: [{ filename: DIRTY }, DIRTY] } }] },
      },
      ALLOW
    )
    expect(JSON.stringify(sanitized)).not.toContain('probe-token')
    expect(JSON.stringify(sanitized)).toContain(CLEAN)
  })

  it('leaves $snapshot_data alone', () => {
    const snapshot = [{ href: DIRTY }]
    const sanitized = sanitizeEventUrls(
      { uuid: 'u', event: '$snapshot', properties: { $snapshot_data: snapshot } },
      ALLOW
    )
    expect(sanitized.properties.$snapshot_data).toEqual(snapshot)
  })

  it('stops at the depth limit without throwing, and never passes the deep value through', () => {
    let deep: Record<string, unknown> = { url: DIRTY }
    for (let level = 0; level < MAX_SANITIZE_DEPTH + 4; level += 1) deep = { child: deep }
    const sanitized = sanitizeEventUrls({ uuid: 'u', event: 'x', properties: { deep } }, ALLOW)
    expect(JSON.stringify(sanitized)).not.toContain('probe-token')
  })

  it('keeps an href with an escaped quote whole in an $elements_chain', () => {
    const sanitized = sanitizeEventUrls(
      {
        uuid: 'u',
        event: '$autocapture',
        properties: {
          $elements_chain: 'a:attr__href="/x?a=\\"&token=probe-token&tab=y"nth-child="1"',
        },
      },
      ALLOW
    )
    expect(sanitized.properties.$elements_chain).toBe('a:attr__href="/x?tab=y"nth-child="1"')
  })
})

describe('sanitizeEventUrls over the events the pinned posthog-js really builds', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    window.history.replaceState(null, '', '/')
  })

  it('leaves no probe value in a $set, $pageview, custom event or $pageleave', async () => {
    server.use(http.all('http://localhost:3000/api/v1/collect/*', () => HttpResponse.json({})))
    window.history.replaceState(
      null,
      '',
      '/register?email=pii-probe%40example.test&token=probe-token&tab=x#frag-probe'
    )
    Object.defineProperty(document, 'referrer', {
      value: 'https://site.test/p?ref=probe-ref',
      configurable: true,
    })
    const raw: CaptureResult[] = []
    const sent: CaptureResult[] = []
    const instance = new PostHog().init(
      'phc_test_key_not_real',
      {
        api_host: 'http://localhost:3000/api/v1/collect',
        defaults: '2026-08-30',
        disable_session_recording: true,
        before_send: (event) => {
          if (event) {
            raw.push(event)
            sent.push(sanitizeEventUrls(event, ALLOW))
          }
          return null
        },
      },
      'url-sanitizer-test'
    )
    instance?.capture('custom_event')
    instance?.capture('$pageleave')

    await expect
      .poll(() => sent.map((event) => event.event))
      .toEqual(expect.arrayContaining(['$pageview', 'custom_event', '$pageleave']))
    // The control: unsanitised, the SDK really did carry the probes.
    expect(JSON.stringify(raw)).toContain('probe-ref')
    const text = JSON.stringify(sent)
    for (const probe of PROBES) expect(text).not.toContain(probe)
  })
})
