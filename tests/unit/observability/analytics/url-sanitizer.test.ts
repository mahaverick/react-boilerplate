import { http, HttpResponse } from 'msw'
import { PostHog, type CaptureResult } from 'posthog-js'
import { afterEach, describe, expect, it } from 'vitest'
import { sanitizeEventUrls, sanitizeUrl } from '@/observability/analytics/url-sanitizer'
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
        $referrer: 'https://site.example/p?ref=probe-ref',
        $session_entry_url: 'https://app.example.com/a?token=probe-token',
        $external_click_url: 'https://elsewhere.example/?q=probe-ref',
        $pathname: '/register',
        $elements: [{ tag_name: 'a', attr__href: '/x?token=probe-token' }],
        $elements_chain:
          'a:attr__href="/x?token=probe-token"href="/x?token=probe-token"nth-child="1"',
        $heatmap_data: { 'https://app.example.com/a?token=probe-token': [{ x: 1 }] },
        $set: { $current_url: 'https://app.example.com/a?token=probe-token' },
        $set_once: { $initial_referrer: 'https://site.example/p?ref=probe-ref' },
        count: 3,
      },
      $set: { $initial_current_url: 'https://app.example.com/a?email=pii-probe' },
      $set_once: { $initial_referrer: 'https://site.example/p?ref=probe-ref' },
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
      value: 'https://site.example/p?ref=probe-ref',
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
